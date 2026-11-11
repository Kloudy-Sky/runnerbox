import { join } from "node:path";
import { ThreadError, ThreadItem, ThreadSubject } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

// A thread on disk: `.server/threads/<id>.ndjson`, owner-only. The first line says what it's about
// and holds the packet it started from; every later line is one item, only ever appended.

export const ThreadHeader = Schema.TaggedStruct("Created", {
  v: Schema.Literal(1),
  id: Schema.String,
  subject: ThreadSubject,
  title: Schema.String,
  packet: Schema.String,
  createdAt: Schema.String,
});
export type ThreadHeader = typeof ThreadHeader.Type;
export type ThreadFile = { readonly header: ThreadHeader; readonly items: ReadonlyArray<ThreadItem> };

const decodeHeader = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadHeader));
const decodeItem = Schema.decodeUnknownEffect(Schema.fromJsonString(ThreadItem));
const encodeLine = (value: ThreadHeader | ThreadItem) => `${JSON.stringify(value)}\n`;

// IDs come from clients, so only the shape `newId` makes can name a file.
const ID = /^[0-9a-f]{16}$/;
const unreadable = () => new ThreadError({ reason: "log_unreadable" });

export const make = (fs: FileSystem.FileSystem, serverDir: string) => {
  const dir = join(serverDir, "threads");
  const pathOf = (id: string) => join(dir, `${id}.ndjson`);

  const create = (header: ThreadHeader) =>
    fs.makeDirectory(dir, { recursive: true, mode: 0o700 }).pipe(
      Effect.andThen(fs.writeFileString(pathOf(header.id), encodeLine(header), { flag: "wx", mode: 0o600 })),
      Effect.mapError(unreadable),
    );

  const append = (id: string, item: ThreadItem) =>
    fs.writeFileString(pathOf(id), encodeLine(item), { flag: "a", mode: 0o600 }).pipe(Effect.mapError(unreadable));

  const read = Effect.fn("ThreadLog.read")(function* (id: string) {
    if (!ID.test(id)) return yield* new ThreadError({ reason: "thread_not_found" });
    const text = yield* fs.readFileString(pathOf(id)).pipe(
      Effect.catchTag("PlatformError", (error) =>
        Effect.fail(error.reason._tag === "NotFound" ? new ThreadError({ reason: "thread_not_found" }) : unreadable()),
      ),
    );
    // A line cut short by a crash mid-write is the last one, and is dropped.
    const [first = "", ...rest] = text.split("\n").filter((line) => line.length > 0);
    const header = yield* decodeHeader(first).pipe(Effect.mapError(unreadable));
    const items = yield* Effect.forEach(rest, (line) => decodeItem(line).pipe(Effect.option));
    return { header, items: items.flatMap((item) => (item._tag === "Some" ? [item.value] : [])) } satisfies ThreadFile;
  });

  const ids = fs.readDirectory(dir).pipe(
    Effect.map((names) => names.flatMap((name) => (name.endsWith(".ndjson") && ID.test(name.slice(0, -7)) ? [name.slice(0, -7)] : []))),
    Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed([]) : Effect.fail(unreadable()))),
  );

  return { create, append, read, ids };
};
