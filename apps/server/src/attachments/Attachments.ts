import { join } from "node:path";
import { ATTACHMENT_LIMITS, type Attachment, AttachmentError, AttachmentName } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { newId } from "../auth/secrets.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { sniff } from "./sniff.ts";

// Files attached to questions, in `.server/attachments`, owner-only. A file is staged first, in
// chunks, by one session: `staged/<id>` holds its bytes and `staged/<id>.json` who staged it. The
// turn it's sent with claims it into `<threadId>/<id>`, which goes when the thread does. A staged
// file never sent is removed after a day.

const Staged = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  name: AttachmentName,
  size: Schema.Int,
  createdAt: Schema.Number,
  attachment: Schema.NullOr(Schema.Struct({ kind: Schema.Literals(["image", "text"]), mimeType: Schema.Literals(["image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]) })),
});
type Staged = typeof Staged.Type;
const decodeStaged = Schema.decodeUnknownEffect(Schema.fromJsonString(Staged));

// IDs come from clients, so only the shape `newId` makes can name a file.
const ID = /^[0-9a-f]{16}$/;
const STAGED_TTL_MS = 24 * 60 * 60_000;

export class Attachments extends Context.Service<
  Attachments,
  {
    readonly stage: (sessionId: string, file: { readonly name: string; readonly size: number }) => Effect.Effect<{ readonly id: string }, AttachmentError>;
    readonly chunk: (sessionId: string, chunk: { readonly id: string; readonly offset: number; readonly data: string }) => Effect.Effect<{ readonly received: number; readonly attachment: Attachment | null }, AttachmentError>;
    readonly discard: (sessionId: string, id: string) => Effect.Effect<void, AttachmentError>;
    // Sending is two steps, so a failure in between leaves the files staged and sendable again.
    // `take` checks finished files this session staged, reads them and holds them for this send;
    // once the question is logged, `keep` moves them into the thread. `release` lets them go if the
    // send failed first.
    readonly take: (sessionId: string, ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<{ readonly attachment: Attachment; readonly bytes: Uint8Array }>, AttachmentError>;
    readonly keep: (threadId: string, ids: ReadonlyArray<string>) => Effect.Effect<void, AttachmentError>;
    readonly release: (ids: ReadonlyArray<string>) => Effect.Effect<void>;
    readonly bytes: (threadId: string, id: string) => Effect.Effect<Uint8Array, AttachmentError>;
    // A sent file as base64 chunks, each its own message, so other calls on the socket go between.
    readonly stream: (threadId: string, id: string) => Stream.Stream<string, AttachmentError>;
    readonly removeThread: (threadId: string) => Effect.Effect<void, AttachmentError>;
    readonly sweep: Effect.Effect<void>;
  }
>()("runnerbox/server/attachments/Attachments") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const root = join(serverDir, "attachments");
  const stagedDir = join(root, "staged");
  const lock = yield* Semaphore.make(1);
  const unreadable = () => new AttachmentError({ reason: "unreadable" });
  const notFound = new AttachmentError({ reason: "not_found" });

  const ensureDir = (dir: string) => fs.makeDirectory(dir, { recursive: true, mode: 0o700 });
  const list = (dir: string) => fs.readDirectory(dir).pipe(Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(error))));
  const sizeOf = (path: string) => fs.stat(path).pipe(Effect.map((info) => Number(info.size)));

  const readStaged = (id: string) =>
    ID.test(id)
      ? fs.readFileString(join(stagedDir, `${id}.json`)).pipe(
          Effect.flatMap(decodeStaged),
          Effect.mapError(() => notFound),
        )
      : Effect.fail(notFound);
  const writeStaged = (staged: Staged) => fs.writeFileString(join(stagedDir, `${staged.id}.json`), JSON.stringify(staged), { mode: 0o600 });
  const allStaged = list(stagedDir).pipe(
    Effect.flatMap((names) => Effect.forEach(names.filter((name) => name.endsWith(".json")), (name) => readStaged(name.slice(0, -5)).pipe(Effect.option))),
    Effect.map((found) => found.flatMap((each) => (each._tag === "Some" ? [each.value] : []))),
  );
  const ownStaged = (sessionId: string, id: string) =>
    readStaged(id).pipe(Effect.flatMap((staged) => (staged.sessionId === sessionId ? Effect.succeed(staged) : Effect.fail(notFound))));
  const removeStaged = (id: string) =>
    Effect.all([fs.remove(join(stagedDir, id), { force: true }), fs.remove(join(stagedDir, `${id}.json`), { force: true })], { discard: true });

  // Staged files count at their declared size from the start, so uploads in flight can't overrun.
  const sentBytes = list(root).pipe(
    Effect.flatMap((dirs) =>
      Effect.forEach(dirs.filter((dir) => ID.test(dir)), (dir) =>
        list(join(root, dir)).pipe(Effect.flatMap((names) => Effect.forEach(names, (name) => sizeOf(join(root, dir, name))))),
      ),
    ),
    Effect.map((sizes) => sizes.flat().reduce((sum, size) => sum + size, 0)),
  );

  const stage = Effect.fn("Attachments.stage")(function* (sessionId: string, file: { readonly name: string; readonly size: number }) {
    if (file.size > ATTACHMENT_LIMITS.fileBytes) return yield* new AttachmentError({ reason: "too_large" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const staged = yield* allStaged;
        const reserved = (of: ReadonlyArray<Staged>) => of.reduce((sum, each) => sum + each.size, 0);
        if (reserved(staged.filter((each) => each.sessionId === sessionId)) + file.size > ATTACHMENT_LIMITS.stagedBytesPerSession) {
          return yield* new AttachmentError({ reason: "session_full" });
        }
        if (reserved(staged) + (yield* sentBytes) + file.size > ATTACHMENT_LIMITS.serverBytes) return yield* new AttachmentError({ reason: "server_full" });
        const id = newId();
        yield* ensureDir(stagedDir);
        yield* fs.writeFile(join(stagedDir, id), new Uint8Array(), { flag: "wx", mode: 0o600 });
        yield* writeStaged({ id, sessionId, name: file.name, size: file.size, createdAt: yield* Clock.currentTimeMillis, attachment: null });
        return { id };
      }).pipe(Effect.catchTag("PlatformError", () => Effect.fail(unreadable()))),
    );
  });

  const chunk = Effect.fn("Attachments.chunk")(function* (sessionId: string, input: { readonly id: string; readonly offset: number; readonly data: string }) {
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const staged = yield* ownStaged(sessionId, input.id);
        const path = join(stagedDir, staged.id);
        const have = yield* sizeOf(path);
        const bytes = Buffer.from(input.data, "base64");
        if (staged.attachment !== null || input.offset !== have || bytes.length === 0) return yield* new AttachmentError({ reason: "out_of_order" });
        if (have + bytes.length > staged.size) return yield* new AttachmentError({ reason: "too_large" });
        yield* fs.writeFile(path, bytes, { flag: "a" });
        const received = have + bytes.length;
        if (received < staged.size) return { received, attachment: null };
        const found = sniff(yield* fs.readFile(path));
        if (found === null || found === "text_too_large") {
          yield* removeStaged(staged.id);
          return yield* new AttachmentError({ reason: found === null ? "unsupported_type" : "too_large" });
        }
        yield* writeStaged({ ...staged, attachment: found });
        return { received, attachment: { id: staged.id, name: staged.name, size: staged.size, ...found } };
      }).pipe(Effect.catchTag("PlatformError", () => Effect.fail(unreadable()))),
    );
  });

  const discard = Effect.fn("Attachments.discard")(function* (sessionId: string, id: string) {
    yield* lock.withPermits(1)(ownStaged(sessionId, id).pipe(Effect.flatMap((staged) => removeStaged(staged.id).pipe(Effect.mapError(unreadable)))));
  });

  // Files a send holds between `take` and `keep`, so two sends can't both take one.
  const held = new Set<string>();

  const take = Effect.fn("Attachments.take")(function* (sessionId: string, ids: ReadonlyArray<string>) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    if (unique.length > ATTACHMENT_LIMITS.perMessage) return yield* new AttachmentError({ reason: "too_many" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (unique.some((id) => held.has(id))) return yield* notFound;
        const staged = yield* Effect.forEach(unique, (id) => ownStaged(sessionId, id));
        const done = staged.flatMap((each) => (each.attachment === null ? [] : [{ ...each, attachment: each.attachment }]));
        if (done.length !== staged.length) return yield* notFound;
        // Text goes into the prompt whole, so a message's text files share one text-sized budget.
        if (done.filter((each) => each.attachment.kind === "text").reduce((sum, each) => sum + each.size, 0) > ATTACHMENT_LIMITS.textBytes) {
          return yield* new AttachmentError({ reason: "too_large" });
        }
        const read = yield* Effect.forEach(done, (each) =>
          fs.readFile(join(stagedDir, each.id)).pipe(
            Effect.mapError(unreadable),
            Effect.map((bytes) => ({ attachment: { id: each.id, name: each.name, size: each.size, ...each.attachment } satisfies Attachment, bytes })),
          ),
        );
        for (const id of unique) held.add(id);
        return read;
      }),
    );
  });

  const release = (ids: ReadonlyArray<string>) => Effect.sync(() => ids.forEach((id) => held.delete(id)));

  const keep = (threadId: string, ids: ReadonlyArray<string>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const dir = join(root, threadId);
        yield* ensureDir(dir);
        yield* Effect.forEach(ids, (id) => fs.rename(join(stagedDir, id), join(dir, id)).pipe(Effect.andThen(fs.remove(join(stagedDir, `${id}.json`), { force: true }))), { discard: true });
      }).pipe(Effect.mapError(unreadable), Effect.ensuring(release(ids))),
    );

  const bytes = (threadId: string, id: string) =>
    ID.test(threadId) && ID.test(id) ? fs.readFile(join(root, threadId, id)).pipe(Effect.mapError(() => notFound)) : Effect.fail(notFound);

  const stream = (threadId: string, id: string) =>
    Stream.unwrap(
      bytes(threadId, id).pipe(
        Effect.map((all) =>
          Stream.range(0, Math.max(0, Math.ceil(all.length / ATTACHMENT_LIMITS.chunkBytes) - 1)).pipe(
            Stream.map((index) => Buffer.from(all.subarray(index * ATTACHMENT_LIMITS.chunkBytes, (index + 1) * ATTACHMENT_LIMITS.chunkBytes)).toString("base64")),
          ),
        ),
      ),
    );

  const removeThread = (threadId: string) =>
    ID.test(threadId) ? lock.withPermits(1)(fs.remove(join(root, threadId), { recursive: true, force: true }).pipe(Effect.mapError(unreadable))) : Effect.fail(notFound);

  const sweep = lock.withPermits(1)(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const names = yield* list(stagedDir);
      const known = yield* allStaged;
      const fresh = new Set(known.filter((each) => now - each.createdAt < STAGED_TTL_MS).map((each) => each.id));
      // Old ones, and any bytes whose record is gone or unreadable.
      yield* Effect.forEach(names, (name) => (fresh.has(name.replace(/\.json$/, "")) ? Effect.void : fs.remove(join(stagedDir, name), { force: true })), { discard: true });
    }),
  ).pipe(Effect.ignore);

  yield* sweep.pipe(Effect.repeat(Schedule.spaced("1 hour")), Effect.forkScoped);

  return Attachments.of({ stage, chunk, discard, take, keep, release, bytes, stream, removeThread, sweep });
});

export const layer = Layer.effect(Attachments, make);
