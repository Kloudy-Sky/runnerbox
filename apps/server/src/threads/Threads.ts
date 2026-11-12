import {
  type AuthScope,
  type ProviderStatus,
  type ReproduceCheck,
  ReproduceError,
  type ReproduceNetwork,
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
import * as AuthStore from "../auth/AuthStore.ts";
import { newId } from "../auth/secrets.ts";
import * as LocalEndpoint from "../config/LocalEndpoint.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import type * as StateLogs from "../history/StateLogs.ts";
import type * as Inbox from "../inbox/Inbox.ts";
import type * as RunnerState from "../runners/RunnerState.ts";
import { Reproduces } from "../reproduce/Reproduces.ts";
import type { Executed } from "../reproduce/UpSocket.ts";
import { systemPrompt, turnPrompt } from "./prompt.ts";
import * as AccountStore from "../accounts/AccountStore.ts";
import { Drivers } from "./provider/Drivers.ts";
import type { ProviderEvent } from "./provider/ProviderAdapter.ts";
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
    // `scopes` are the asking session's: only one holding `threads:reproduce` gives the turn the
    // reproduce's shell tool, whoever started the reproduce.
    readonly startTurn: (id: string, text: string, options: { readonly accountId?: string | undefined; readonly scopes: ReadonlyArray<AuthScope> }) => Effect.Effect<{ readonly turnId: string }, ThreadError>;
    // Returns once the turn has ended and that's logged. Does nothing when no turn is running.
    readonly interrupt: (id: string) => Effect.Effect<void, ThreadError>;
    readonly subscribe: (id: string) => Stream.Stream<ThreadEvent, ThreadError>;
    readonly checkReproduce: (id: string) => Effect.Effect<ReproduceCheck, ThreadError>;
    // The owner's click: starts the thread's reproduce and logs it. Only between turns.
    readonly startReproduce: (id: string, network: ReproduceNetwork) => Effect.Effect<void, ThreadError | ReproduceError>;
    readonly stopReproduce: (id: string) => Effect.Effect<void, ThreadError | ReproduceError>;
    // A command from the agent's `repro_exec`, for the thread its turn token is bound to. Logged
    // in that turn with the end of its output.
    readonly reproduceExec: (sessionId: string, command: string, timeoutSec: number) => Effect.Effect<Executed, ReproduceError>;
  }
>()("runnerbox/server/threads/Threads") {}

type Running = { readonly turnId: string; nextSeq: number; partial: string; costUsd: number | null; fiber?: Fiber.Fiber<void, unknown> };

const MAX_TOOL_INPUT = 300;
// A turn's MCP token is revoked when the turn ends. This only bounds one a crash left behind.
const TURN_TOKEN_TTL_MS = 30 * 60_000;
const nowIso = Clock.currentTimeMillis.pipe(Effect.map((ms) => new Date(ms).toISOString()));

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const { serverDir } = yield* ServerPaths.ServerPaths;
  const drivers = yield* Drivers;
  const accounts = yield* AccountStore.AccountStore;
  const reproduces = yield* Reproduces;
  // Whether the default account can run turns, for a client deciding whether to offer threads.
  const provider = accounts.resolve(undefined).pipe(
    Effect.flatMap((account) => drivers.get(account.driver).status({ hasKey: account.apiKey !== null })),
    Effect.catch(() => Effect.succeed<ProviderStatus>({ provider: "Claude", available: false, fix: "Couldn't read the accounts file on the server." })),
  );
  const auth = yield* AuthStore.AuthStore;
  const { baseUrl } = yield* LocalEndpoint.LocalEndpoint;
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
    const added: ThreadItem[] = [];
    const nextSeq = () => (added.at(-1) ?? file.items.at(-1))!.seq + 1;
    const lastTurn = file.items.findLast((item) => "turnId" in item);
    if (lastTurn && lastTurn._tag !== "TurnEnded" && !running.has(id)) {
      added.push({ _tag: "TurnEnded", seq: nextSeq(), turnId: lastTurn.turnId, outcome: "interrupted", message: "The server stopped during this turn.", costUsd: null, at: yield* nowIso });
    }
    // A reproduce this server no longer tracks; `up` removes its container once it's idle.
    const lastReproduce = file.items.findLast((item) => item._tag === "ReproduceStarted" || item._tag === "ReproduceEnded");
    if (lastReproduce?._tag === "ReproduceStarted" && !reproduces.startedHere(id)) {
      added.push({ _tag: "ReproduceEnded", seq: nextSeq(), reason: "The server restarted, so this reproduce ended.", at: yield* nowIso });
    }
    yield* Effect.forEach(added, (item) => appendUnlocked(id, item));
    return { ...file, items: [...file.items, ...added] };
  });

  // Logs an item outside a turn's own stream, after whatever the running turn has logged.
  const appendNow = (id: string, make: (seq: number, at: string) => ThreadItem) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const turn = running.get(id);
        const seq = turn ? turn.nextSeq : ((yield* loadUnlocked(id)).items.at(-1)?.seq ?? 0) + 1;
        if (turn) turn.nextSeq += 1;
        yield* appendUnlocked(id, make(seq, yield* nowIso));
      }),
    );

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

  const ended = (id: string, reason: string) => appendNow(id, (seq, at) => ({ _tag: "ReproduceEnded", seq, reason, at }));

  // `up` removes a reproduce on its own, for real jobs' memory, idling or age, and never says so.
  // Asking before a turn, and whenever the app checks, logs that end once with `up`'s reason.
  const settleReproduce = (id: string) =>
    reproduces.refresh(id).pipe(Effect.flatMap((reason) => (reason === null ? Effect.void : ended(id, reason).pipe(Effect.ignore))));

  const startTurn = Effect.fn("Threads.startTurn")(function* (id: string, text: string, { accountId, scopes }: { readonly accountId?: string | undefined; readonly scopes: ReadonlyArray<AuthScope> }) {
    const account = yield* accounts
      .resolve(accountId)
      .pipe(Effect.mapError((error) => new ThreadError({ reason: error.reason === "not_found" ? "account_not_found" : "log_unreadable" })));
    // So a turn doesn't get the shell for a container `up` already removed.
    yield* settleReproduce(id);
    const driver = drivers.get(account.driver);
    const status = yield* driver.status({ hasKey: account.apiKey !== null });
    if (!status.available) return yield* new ThreadError({ reason: "provider_unavailable" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (running.has(id)) return yield* new ThreadError({ reason: "turn_running" });
        const file = yield* loadUnlocked(id);
        const turn: Running = { turnId: newId(), nextSeq: (file.items.at(-1)?.seq ?? 0) + 1, partial: "", costUsd: null };
        // The account's ID only: its key never goes in a thread's log.
        yield* appendUnlocked(id, { _tag: "UserMessage", seq: turn.nextSeq, turnId: turn.turnId, text, at: yield* nowIso, accountId: account.id });
        turn.nextSeq += 1;
        running.set(id, turn);
        const prompt = turnPrompt(file.header.packet, file.items, text);
        // Only a turn that starts with a reproduce running, asked by a session that may reproduce,
        // gets the tool, bound to this thread.
        const reproducing = reproduces.running(id) && scopes.includes("threads:reproduce");
        // The agent's tools are `/mcp` itself, read-only, with a token that lives for this turn.
        // Forked into the service's scope, so stopping the server interrupts it and logs that.
        turn.fiber = yield* Effect.gen(function* () {
          const grant = yield* Effect.acquireRelease(auth.mintMcpToken("agent thread", { ttlMs: TURN_TOKEN_TTL_MS }), ({ session }) =>
            auth.revoke(session.id).pipe(Effect.ignore),
          );
          if (reproducing) yield* reproduces.bind(grant.session.id, id);
          yield* driver
            .runTurn({
              systemPrompt: systemPrompt(reproducing),
              prompt,
              mcp: { url: `${baseUrl}/mcp`, token: grant.token },
              reproduce: reproducing,
              account: { label: account.label, model: account.model, apiKey: account.apiKey },
            })
            .pipe(Stream.runForEach(onEvent(id, turn)));
        }).pipe(
          Effect.scoped,
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

  const header = (id: string) => log.read(id).pipe(Effect.map((file) => file.header));
  const jobIdOf = (subject: ThreadSubject) => (subject._tag === "run" ? subject.jobId : null);

  const checkReproduce = Effect.fn("Threads.checkReproduce")(function* (id: string) {
    const { packet, subject } = yield* header(id);
    yield* settleReproduce(id);
    return yield* reproduces.check(packet, jobIdOf(subject));
  });

  const startReproduce = Effect.fn("Threads.startReproduce")(function* (id: string, network: ReproduceNetwork) {
    const { packet, subject } = yield* header(id);
    if (running.has(id)) return yield* new ThreadError({ reason: "turn_running" });
    const started = yield* reproduces.start(id, packet, jobIdOf(subject), network);
    yield* appendNow(id, (seq, at) => ({ _tag: "ReproduceStarted", seq, ...started, network, at }));
  });

  const stopReproduce = Effect.fn("Threads.stopReproduce")(function* (id: string) {
    yield* header(id);
    const reason = yield* reproduces.stop(id).pipe(Effect.tapError(() => (reproduces.running(id) ? Effect.void : ended(id, "The owner stopped it.").pipe(Effect.ignore))));
    if (reason !== null) yield* ended(id, reason);
  });

  const OUTPUT_KEPT = 4000;
  const reproduceExec = Effect.fn("Threads.reproduceExec")(function* (sessionId: string, command: string, timeoutSec: number) {
    const id = reproduces.boundThread(sessionId);
    if (id === undefined) return yield* new ReproduceError({ why: "This token can't run commands. Only a thread's turn with a reproduce running can." });
    const result = yield* reproduces.exec(id, command, timeoutSec).pipe(
      Effect.catchTag("ExecFailed", (failure) =>
        (failure.endedHere ? ended(id, failure.why).pipe(Effect.ignore) : Effect.void).pipe(Effect.andThen(Effect.fail(new ReproduceError({ why: failure.why })))),
      ),
    );
    const turn = running.get(id);
    if (turn) {
      yield* record(id, turn, (seq, at) => ({
        _tag: "ReproduceCommand",
        seq,
        turnId: turn.turnId,
        command,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        output: result.output.slice(-OUTPUT_KEPT),
        truncated: result.truncated || result.output.length > OUTPUT_KEPT,
        at,
      })).pipe(Effect.ignore);
    }
    return result;
  });

  return Threads.of({ provider, list, read, create, startTurn, interrupt, subscribe, checkReproduce, startReproduce, stopReproduce, reproduceExec });
});

export const layer = Layer.effect(Threads, make);
