import {
  type ProviderStatus,
  subjectKey,
  type ThreadDetail,
  ThreadError,
  type ThreadEvent,
  type ThreadItem,
  type ThreadSubject,
  type ThreadSummary,
} from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { newId } from "../auth/secrets.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import type * as StateLogs from "../history/StateLogs.ts";
import type * as Inbox from "../inbox/Inbox.ts";
import type * as RunnerState from "../runners/RunnerState.ts";
import * as AgentTools from "./AgentTools.ts";
import { SYSTEM_PROMPT, turnPrompt } from "./prompt.ts";
import { ProviderAdapter, type ProviderEvent } from "./provider/ProviderAdapter.ts";
import { subjectPacket } from "./subjectPacket.ts";
import * as ThreadLog from "./ThreadLog.ts";

// Agent threads on a CI subject. A thread is its log; this service adds the one turn each thread
// may have running, and streams what the log gains.
export class Threads extends Context.Service<
  Threads,
  {
    readonly provider: Effect.Effect<ProviderStatus>;
    readonly list: (subject?: ThreadSubject) => Effect.Effect<ReadonlyArray<ThreadSummary>, ThreadError>;
    readonly read: (id: string) => Effect.Effect<ThreadDetail, ThreadError>;
    readonly create: (subject: ThreadSubject, days: number) => Effect.Effect<ThreadSummary, ThreadError>;
    // Logs the question and starts the turn in the background; it ends on the thread's stream.
    readonly startTurn: (id: string, text: string) => Effect.Effect<{ readonly turnId: string }, ThreadError>;
    // Returns once the turn has ended and that's logged. Does nothing when no turn is running.
    readonly interrupt: (id: string) => Effect.Effect<void, ThreadError>;
    readonly subscribe: (id: string) => Stream.Stream<ThreadEvent, ThreadError>;
  }
>()("runnerbox/server/threads/Threads") {}

type Running = { readonly turnId: string; nextSeq: number; partial: string; costUsd: number | null; fiber?: Fiber.Fiber<void, unknown> };

const MAX_TOOL_INPUT = 300;
const nowIso = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const provider = yield* ProviderAdapter;
  const tools = yield* AgentTools.make;
  const readers = yield* Effect.context<Inbox.Inbox | StateLogs.StateLogs | RunnerState.RunnerState>();
  const log = ThreadLog.make(fs, serverDir);
  const scope = yield* Effect.scope;
  // One lock orders every append with its publish, and every snapshot with its subscription, so
  // a stream never misses or repeats an item.
  const lock = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<{ readonly threadId: string; readonly event: ThreadEvent }>();
  const running = new Map<string, Running>();

  const publish = (threadId: string, event: ThreadEvent) => PubSub.publish(events, { threadId, event }).pipe(Effect.asVoid);
  const appendUnlocked = (threadId: string, item: ThreadItem) => log.append(threadId, item).pipe(Effect.andThen(publish(threadId, item)));

  const summary = ({ header, items }: ThreadLog.ThreadFile): ThreadSummary => ({
    id: header.id,
    subject: header.subject,
    title: header.title,
    createdAt: header.createdAt,
    lastAt: items.at(-1)?.at ?? header.createdAt,
    running: running.has(header.id),
  });

  // A turn with no end and nothing running ended when the server stopped under it. Call holding
  // the lock.
  const loadUnlocked = Effect.fn("Threads.load")(function* (id: string) {
    const file = yield* log.read(id);
    const last = file.items.at(-1);
    if (last === undefined || last._tag === "TurnEnded" || running.has(id)) return file;
    const ended: ThreadItem = { _tag: "TurnEnded", seq: last.seq + 1, turnId: last.turnId, outcome: "interrupted", message: "The server stopped during this turn.", costUsd: null, at: yield* nowIso };
    yield* appendUnlocked(id, ended);
    return { ...file, items: [...file.items, ended] };
  });

  const list = Effect.fn("Threads.list")(function* (subject?: ThreadSubject) {
    const files = yield* Effect.forEach(yield* log.ids, (id) => log.read(id).pipe(Effect.option));
    return files
      .flatMap((file) => (file._tag === "Some" ? [summary(file.value)] : []))
      .filter((thread) => subject === undefined || subjectKey(thread.subject) === subjectKey(subject))
      .toSorted((a, b) => b.lastAt.localeCompare(a.lastAt));
  });

  const read = (id: string) => lock.withPermits(1)(loadUnlocked(id)).pipe(Effect.map((file) => ({ thread: summary(file), items: file.items })));

  const create = Effect.fn("Threads.create")(function* (subject: ThreadSubject, days: number) {
    const { title, packet } = yield* subjectPacket(subject, days).pipe(Effect.provideContext(readers));
    const header: ThreadLog.ThreadHeader = { _tag: "Created", v: 1, id: newId(), subject, title, packet, createdAt: yield* nowIso };
    yield* log.create(header);
    return summary({ header, items: [] });
  });

  // Uninterruptible, so a Stop can't land between logging an item, publishing it and updating
  // the turn: what the user saw stream is either logged here or kept by `endTurn`.
  const record = (id: string, turn: Running, make: (seq: number, at: string) => ThreadItem) =>
    lock.withPermits(1)(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const item = make(turn.nextSeq, yield* nowIso);
          yield* appendUnlocked(id, item);
          turn.nextSeq += 1;
          if (item._tag === "AgentText") turn.partial = "";
        }),
      ),
    );

  const onEvent = (id: string, turn: Running) => (event: ProviderEvent) => {
    const { turnId } = turn;
    switch (event._tag) {
      case "TextDelta":
        return lock.withPermits(1)(
          Effect.suspend(() => {
            turn.partial += event.text;
            return publish(id, { _tag: "AgentTextDelta", turnId, text: event.text });
          }),
        );
      case "Text":
        return event.text.trim() === "" ? Effect.void : record(id, turn, (seq, at) => ({ _tag: "AgentText", seq, turnId, text: event.text, at }));
      case "ToolCall":
        return record(id, turn, (seq, at) => ({ _tag: "ToolCall", seq, turnId, name: event.name, input: JSON.stringify(event.input ?? {}).slice(0, MAX_TOOL_INPUT), at }));
      case "Done":
        return Effect.sync(() => {
          turn.costUsd = event.costUsd;
        });
    }
  };

  // Text streamed before a stop is kept, so what the user saw stays in the thread.
  const endTurn = (id: string, turn: Running, exit: Exit.Exit<void, { readonly message: string } | ThreadError>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const at = yield* nowIso;
        if (turn.partial.trim() !== "") {
          yield* appendUnlocked(id, { _tag: "AgentText", seq: turn.nextSeq, turnId: turn.turnId, text: turn.partial, at });
          turn.nextSeq += 1;
        }
        const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;
        const outcome = Exit.isSuccess(exit) ? "completed" : Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "failed";
        const message = outcome !== "failed" ? null : failure?._tag === "Some" ? failure.value.message : "The turn failed.";
        yield* appendUnlocked(id, { _tag: "TurnEnded", seq: turn.nextSeq, turnId: turn.turnId, outcome, message, costUsd: turn.costUsd, at });
      }).pipe(
        Effect.ignore,
        Effect.ensuring(Effect.sync(() => running.delete(id))),
      ),
    );

  const startTurn = Effect.fn("Threads.startTurn")(function* (id: string, text: string) {
    const status = yield* provider.status;
    if (!status.available) return yield* new ThreadError({ reason: "provider_unavailable" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (running.has(id)) return yield* new ThreadError({ reason: "turn_running" });
        const file = yield* loadUnlocked(id);
        const turn: Running = { turnId: newId(), nextSeq: (file.items.at(-1)?.seq ?? 0) + 1, partial: "", costUsd: null };
        yield* appendUnlocked(id, { _tag: "UserMessage", seq: turn.nextSeq, turnId: turn.turnId, text, at: yield* nowIso });
        turn.nextSeq += 1;
        running.set(id, turn);
        const prompt = turnPrompt(file.header.packet, file.items, text);
        // Forked into the service's scope, so stopping the server interrupts it and logs that.
        turn.fiber = yield* provider.runTurn({ systemPrompt: SYSTEM_PROMPT, prompt, tools }).pipe(
          Stream.runForEach(onEvent(id, turn)),
          Effect.onExit((exit) => endTurn(id, turn, exit)),
          Effect.forkIn(scope),
        );
        return { turnId: turn.turnId };
      }),
    );
  });

  const interrupt = Effect.fn("Threads.interrupt")(function* (id: string) {
    const fiber = running.get(id)?.fiber;
    if (fiber) yield* Fiber.interrupt(fiber);
  });

  const subscribe = (id: string) =>
    Stream.unwrap(
      lock.withPermits(1)(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(events);
          const file = yield* loadUnlocked(id);
          const turn = running.get(id);
          const snapshot: ThreadEvent = {
            _tag: "Snapshot",
            detail: { thread: summary(file), items: file.items },
            partial: turn && turn.partial !== "" ? { turnId: turn.turnId, text: turn.partial } : null,
          };
          return Stream.make(snapshot).pipe(
            Stream.concat(Stream.fromSubscription(subscription).pipe(Stream.filter((entry) => entry.threadId === id), Stream.map((entry) => entry.event))),
          );
        }),
      ),
    );

  return Threads.of({ provider: provider.status, list, read, create, startTurn, interrupt, subscribe });
});

export const layer = Layer.effect(Threads, make);
