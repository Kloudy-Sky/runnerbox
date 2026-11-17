import { join } from "node:path";
import { type InboxItem, InboxStateError } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileAtomic } from "../config/atomicWrite.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import { blankState, isBlank, itemState, settle, snooze, StoredItemState, unsettle, wake } from "./itemState.ts";

// Which inbox items the owner snoozed or settled, kept in `.server/inbox.json` by the machine that
// reports them, so a snooze holds on every device. It changes only what the app shows.

const DAY_MS = 24 * 60 * 60_000;
// State for an item the inbox hasn't shown in this long is dropped. By then it can only come back
// with a new failure, which would undo the owner's choice anyway.
const FORGET_AFTER_MS = 30 * DAY_MS;
// `seenAt` is moved at most this often, so listing the inbox rarely writes.
const SEEN_EVERY_MS = DAY_MS;

const State = Schema.Struct({ v: Schema.Literal(1), items: Schema.Record(Schema.String, StoredItemState) });
type State = typeof State.Type;
const decodeState = Schema.decodeUnknownEffect(Schema.fromJsonString(State));

export class InboxState extends Context.Service<
  InboxState,
  {
    // The items with their state. It also notes that the inbox showed them and drops state for
    // items gone a while. It never fails: an unreadable file leaves the items without state.
    readonly attach: (items: ReadonlyArray<InboxItem>) => Effect.Effect<InboxItem[]>;
    readonly settle: (id: string) => Effect.Effect<void, InboxStateError>;
    readonly unsettle: (id: string) => Effect.Effect<void, InboxStateError>;
    // Fails when `until` isn't in the future.
    readonly snooze: (id: string, until: string) => Effect.Effect<void, InboxStateError>;
    readonly wake: (id: string) => Effect.Effect<void, InboxStateError>;
  }
>()("runnerbox/server/inbox/InboxState") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const path = join(serverDir, "inbox.json");
  const unreadable = () => new InboxStateError({ why: "Couldn't read or write the inbox's snoozes on the server." });
  const lock = yield* Semaphore.make(1);

  const read = Effect.gen(function* () {
    const text = yield* fs.readFileString(path).pipe(
      Effect.map(Option.some),
      Effect.catchTag("PlatformError", (error) => (error.reason._tag === "NotFound" ? Effect.succeed(Option.none<string>()) : Effect.fail(error))),
    );
    return Option.isSome(text) ? yield* decodeState(text.value) : { v: 1 as const, items: {} };
  }).pipe(Effect.mapError(unreadable));
  const write = (state: State) =>
    fs.makeDirectory(serverDir, { recursive: true, mode: 0o700 }).pipe(Effect.andThen(writeFileAtomic(fs, path, `${JSON.stringify(state, null, 2)}\n`)), Effect.mapError(unreadable));
  // Runs `change` on the stored items under the lock, writing only when it returns new ones.
  const update = (change: (items: State["items"], now: number) => State["items"] | null) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const state = yield* read;
        const now = yield* Clock.currentTimeMillis;
        const next = change(state.items, now);
        if (next !== null) yield* write({ ...state, items: next });
        return { items: next ?? state.items, now };
      }),
    );
  // Applies one choice to one item. An entry left with nothing to remember is dropped.
  const changeOne = (id: string, apply: (stored: StoredItemState, now: string) => StoredItemState) =>
    update((items, now) => {
      const { [id]: before, ...rest } = items;
      const after = apply(before ?? blankState(new Date(now).toISOString()), new Date(now).toISOString());
      return isBlank(after) ? rest : { ...rest, [id]: after };
    }).pipe(Effect.asVoid);

  const attach = Effect.fn("InboxState.attach")(function* (shown: ReadonlyArray<InboxItem>) {
    const ids = new Set(shown.map((item) => item.id));
    const result = yield* update((items, now) => {
      const seenAt = new Date(now).toISOString();
      const age = (stored: StoredItemState) => now - Date.parse(stored.seenAt);
      const entries = Object.entries(items);
      if (!entries.some(([id, stored]) => age(stored) >= (ids.has(id) ? SEEN_EVERY_MS : FORGET_AFTER_MS))) return null;
      return Object.fromEntries(
        entries.flatMap(([id, stored]) => (ids.has(id) ? [[id, { ...stored, seenAt }]] : age(stored) >= FORGET_AFTER_MS ? [] : [[id, stored]])),
      );
    }).pipe(
      Effect.catch((error) => Effect.logWarning(`inbox: listed without snoozes: ${error.message}`).pipe(Effect.as(null))),
    );
    return result === null ? [...shown] : shown.map((item) => ({ ...item, state: itemState(result.items[item.id], item, result.now) }));
  });

  const snoozeItem = Effect.fn("InboxState.snooze")(function* (id: string, until: string) {
    if (Date.parse(until) <= (yield* Clock.currentTimeMillis)) return yield* new InboxStateError({ why: "Pick a time that hasn't passed." });
    yield* changeOne(id, (stored, now) => snooze(stored, until, now));
  });

  return InboxState.of({
    attach,
    settle: (id) => changeOne(id, settle),
    unsettle: (id) => changeOne(id, unsettle),
    snooze: snoozeItem,
    wake: (id) => changeOne(id, wake),
  });
});

export const layer = Layer.effect(InboxState, make);
