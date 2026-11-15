import {
  type AttachmentError,
  type AuthScope,
  type Harness,
  type Proposal,
  ProposalError,
  ProviderDriver,
  type ProviderStatus,
  type QueuedMessage,
  type ReproduceCheck,
  ReproduceError,
  type ReproduceNetwork,
  subjectKey,
  type ThreadDetail,
  ThreadError,
  type ThreadEvent,
  type ThreadItem,
  type ThreadReference,
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
import { Attachments } from "../attachments/Attachments.ts";
import * as AuthStore from "../auth/AuthStore.ts";
import { newId } from "../auth/secrets.ts";
import * as LocalEndpoint from "../config/LocalEndpoint.ts";
import * as ServerPaths from "../config/ServerPaths.ts";
import type * as StateLogs from "../history/StateLogs.ts";
import type * as Inbox from "../inbox/Inbox.ts";
import type * as RunnerState from "../runners/RunnerState.ts";
import { type ProposeInput, Proposals } from "../proposals/Proposals.ts";
import { runUrlOf } from "../proposals/runUrl.ts";
import { Reproduces } from "../reproduce/Reproduces.ts";
import type { Executed } from "../reproduce/UpSocket.ts";
import { systemPrompt, turnPrompt } from "./prompt.ts";
import * as AccountStore from "../accounts/AccountStore.ts";
import { Drivers } from "./provider/Drivers.ts";
import { driverStatus, HARNESSES, offersModel } from "./provider/harnesses.ts";
import type { ProviderEvent } from "./provider/ProviderAdapter.ts";
import { resolveReference } from "./references.ts";
import { subjectPacket } from "./subjectPacket.ts";
import * as ThreadLog from "./ThreadLog.ts";

// Agent threads on a CI subject. A thread is its log; this service adds the one turn each thread
// may have running, and streams what the log gains.
export class Threads extends Context.Service<
  Threads,
  {
    readonly provider: Effect.Effect<ProviderStatus>;
    readonly harnesses: Effect.Effect<ReadonlyArray<Harness>>;
    readonly list: (subject?: ThreadSubject) => Effect.Effect<ReadonlyArray<ThreadSummary>, ThreadError>;
    readonly read: (id: string) => Effect.Effect<ThreadDetail, ThreadError>;
    readonly create: (subject: ThreadSubject, days: number) => Effect.Effect<ThreadSummary, ThreadError>;
    // Logs the question and starts the turn in the background; it ends on the thread's stream.
    // `scopes` are the asking session's: only one holding `threads:reproduce` gives the turn the
    // reproduce's shell tool, whoever started the reproduce.
    // `monitor` marks a turn a monitor started: logged as the monitor's, on its model, and read-only,
    // with no proposals and no reproduce.
    readonly startTurn: (id: string, text: string, options: TurnOptions) => Effect.Effect<{ readonly turnId: string }, ThreadError | AttachmentError>;
    // Starts the turn, or while one runs, holds it (one per thread) and starts it when that turn
    // ends, unless the owner stops that turn. `turnId` is null while it waits. Nothing else can
    // start a turn in the thread while it waits, so a monitor never slips in ahead of it.
    readonly queueTurn: (id: string, text: string, options: TurnOptions) => Effect.Effect<{ readonly turnId: string | null }, ThreadError | AttachmentError>;
    // Drops the waiting question; its stream hands the text back.
    readonly cancelQueued: (id: string) => Effect.Effect<void, ThreadError>;
    // Removes the log and its attachments, and ends its streams. Refused while a turn or a
    // reproduce runs.
    readonly remove: (id: string) => Effect.Effect<void, ThreadError>;
    // Returns once the turn has ended and that's logged. Does nothing when no turn is running.
    // A question waiting behind it isn't sent: its stream hands the text back.
    readonly interrupt: (id: string) => Effect.Effect<void, ThreadError>;
    // Stops one turn, if it's still the one running, and lets a question waiting behind it start.
    // For a monitor stopping its own look.
    readonly stopTurn: (id: string, turnId: string) => Effect.Effect<void>;
    readonly subscribe: (id: string) => Stream.Stream<ThreadEvent, ThreadError>;
    readonly checkReproduce: (id: string) => Effect.Effect<ReproduceCheck, ThreadError>;
    // The owner's click: starts the thread's reproduce and logs it. Only between turns.
    readonly startReproduce: (id: string, network: ReproduceNetwork) => Effect.Effect<void, ThreadError | ReproduceError>;
    readonly stopReproduce: (id: string) => Effect.Effect<void, ThreadError | ReproduceError>;
    // A command from the agent's `repro_exec`, for the thread its turn token is bound to. Logged
    // in that turn with the end of its output.
    readonly reproduceExec: (sessionId: string, command: string, timeoutSec: number) => Effect.Effect<Executed, ReproduceError>;
    // The agent's `propose_change`, for the thread its turn token is bound to. It only records.
    readonly proposeChange: (sessionId: string, input: { readonly install: string; readonly changes: ProposeInput["changes"]; readonly reason: string }) => Effect.Effect<Proposal, ProposalError>;
  }
>()("runnerbox/server/threads/Threads") {}

// `model` is the composer's pick, one of the account's driver's offered models. It wins over the
// account's own model; a monitor's model wins over both.
// `attachments` are files `sessionId` staged, claimed into the thread with the question.
// `references` are other threads and runs, read once now and logged with it.
export type TurnOptions = {
  readonly references?: ReadonlyArray<ThreadReference> | undefined;
  readonly accountId?: string | undefined;
  readonly model?: string | undefined;
  readonly attachments?: { readonly sessionId: string; readonly ids: ReadonlyArray<string> } | undefined;
  readonly scopes: ReadonlyArray<AuthScope>;
  readonly monitor?: { readonly model: string } | undefined;
};

type Waiting = { readonly message: QueuedMessage; readonly options: TurnOptions };
// `yieldsToQueue` is set when a monitor stops its look, so the question waiting behind it still
// goes; a stop by the server leaves it to be lost with the restart.
type Running = {
  yieldsToQueue?: boolean; readonly turnId: string; nextSeq: number; partial: string; costUsd: number | null; fiber?: Fiber.Fiber<void, unknown> };

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
  const proposals = yield* Proposals;
  const attachments = yield* Attachments;
  // Every turn's MCP token, mapped to its thread for the turn, so a tool knows whose thread it's in.
  const turnSessions = new Map<string, string>();
  // Whether the default account can run turns, for a client deciding whether to offer threads.
  const provider = accounts.resolve(undefined).pipe(
    Effect.flatMap((account) => drivers.get(account.driver).status({ hasKey: account.apiKey !== null })),
    Effect.catch(() => Effect.succeed<ProviderStatus>({ provider: "Claude", available: false, fix: "Couldn't read the accounts file on the server." })),
  );
  // An unreadable accounts file says so, as `provider` does, since adding an account would fail too.
  const harnessesOf = (status: (driver: ProviderDriver, label: string) => ProviderStatus) =>
    ProviderDriver.literals.map((driver): Harness => ({ driver, label: HARNESSES[driver].label, status: status(driver, HARNESSES[driver].label), models: HARNESSES[driver].models }));
  const harnesses = accounts.list.pipe(
    Effect.map((all) => harnessesOf((driver, label) => driverStatus(label, all.filter((account) => account.driver === driver)))),
    Effect.catch(() => Effect.succeed(harnessesOf((_, label) => ({ provider: label, available: false, fix: "Couldn't read the accounts file on the server." })))),
  );
  const auth = yield* AuthStore.AuthStore;
  const endpoint = yield* LocalEndpoint.LocalEndpoint;
  const readers = yield* Effect.context<Inbox.Inbox | StateLogs.StateLogs | RunnerState.RunnerState>();
  const log = ThreadLog.make(fs, serverDir);
  const scope = yield* Effect.scope;
  // One lock orders every append with its publish, and every snapshot with its subscription, so
  // a stream never misses or repeats an item.
  const lock = yield* Semaphore.make(1);
  const events = yield* PubSub.unbounded<{ readonly threadId: string; readonly event: ThreadEvent }>();
  const running = new Map<string, Running>();
  // Threads whose reproduce `up` is still starting, which can take seconds outside the lock.
  const reproduceStarting = new Set<string>();
  // In memory only: a restart loses it, and the client hands its text back to the composer.
  const queued = new Map<string, Waiting>();

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
    ).pipe(
      // A stop by the owner already handed the waiting question back.
      Effect.andThen(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) && !turn.yieldsToQueue ? Effect.void : startQueued(id)),
    );

  const clearQueue = (id: string, reason: "started" | "cancelled" | "stopped" | "failed", message: string | null) =>
    lock.withPermits(1)(
      Effect.suspend(() => {
        const waiting = queued.get(id);
        if (!waiting) return Effect.void;
        queued.delete(id);
        return publish(id, { _tag: "QueueCleared", reason, text: waiting.message.text, message });
      }),
    );

  // Starts the waiting question as an ordinary turn of the owner's.
  const startQueued = (id: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const waiting = queued.get(id);
      if (!waiting) return Effect.void;
      // `begin` takes it off the queue as it logs it, so only one of starting it and Stop wins.
      return begin(id, waiting.message.text, waiting.options, waiting).pipe(
        Effect.asVoid,
        Effect.catch((error) => (queued.get(id) === waiting ? clearQueue(id, "failed", error.message) : Effect.void)),
      );
    });

  const ended = (id: string, reason: string) => appendNow(id, (seq, at) => ({ _tag: "ReproduceEnded", seq, reason, at }));

  // `up` removes a reproduce on its own, for real jobs' memory, idling or age, and never says so.
  // Asking before a turn, and whenever the app checks, logs that end once with `up`'s reason.
  const settleReproduce = (id: string) =>
    reproduces.refresh(id).pipe(Effect.flatMap((reason) => (reason === null ? Effect.void : ended(id, reason).pipe(Effect.ignore))));

  // `fromQueue` is the waiting question itself, the one start a waiting question doesn't block.
  // It starts only if it's still waiting when the lock is taken: Stop or Cancel may have won.
  const begin = Effect.fn("Threads.begin")(function* (id: string, text: string, { accountId, model, attachments: attaching, references: referring = [], scopes, monitor }: TurnOptions, fromQueue: Waiting | null) {
    const account = yield* accounts
      .resolve(accountId)
      .pipe(Effect.mapError((error) => new ThreadError({ reason: error.reason === "not_found" ? "account_not_found" : "log_unreadable" })));
    if (model !== undefined && !offersModel(account.driver, model)) return yield* new ThreadError({ reason: "model_not_offered" });
    const references = yield* Effect.forEach(referring, (ref) => resolveReference(log.read, id, ref).pipe(Effect.provideContext(readers)));
    // So a turn doesn't get the shell for a container `up` already removed.
    yield* settleReproduce(id);
    const driver = drivers.get(account.driver);
    const status = yield* driver.status({ hasKey: account.apiKey !== null });
    if (!status.available) return yield* new ThreadError({ reason: "provider_unavailable" });
    return yield* lock.withPermits(1)(
      Effect.gen(function* () {
        if (running.has(id) || (fromQueue === null ? queued.has(id) : queued.get(id) !== fromQueue)) return yield* new ThreadError({ reason: "turn_running" });
        const file = yield* loadUnlocked(id);
        const turn: Running = { turnId: newId(), nextSeq: (file.items.at(-1)?.seq ?? 0) + 1, partial: "", costUsd: null };
        const taken = attaching === undefined ? [] : yield* attachments.take(attaching.sessionId, attaching.ids);
        const attached = taken.map((each) => each.attachment);
        const contents = taken.map((each) => ({ ...each.attachment, bytes: each.bytes }));
        const ids = attached.map((each) => each.id);
        // The account's ID only: its key never goes in a thread's log.
        yield* appendUnlocked(id, {
          _tag: "UserMessage",
          seq: turn.nextSeq,
          turnId: turn.turnId,
          text,
          at: yield* nowIso,
          accountId: account.id,
          ...(model !== undefined && !monitor ? { model } : {}),
          ...(attached.length > 0 ? { attachments: attached } : {}),
          ...(references.length > 0 ? { references } : {}),
          ...(monitor ? { source: "monitor" as const } : {}),
        }).pipe(Effect.onError(() => attachments.release(ids)));
        if (fromQueue !== null) {
          queued.delete(id);
          yield* publish(id, { _tag: "QueueCleared", reason: "started", text, message: null });
        }
        // Logged, so the files are the thread's now. If moving one fails it stays staged until it
        // expires, and the thread shows it as missing; the turn already has its bytes.
        yield* attachments.keep(id, ids).pipe(Effect.ignore);
        turn.nextSeq += 1;
        running.set(id, turn);
        const images = contents.filter((each) => each.kind === "image");
        const prompt = turnPrompt(file.header.packet, file.items, text, {
          texts: contents.filter((each) => each.kind === "text").map((each) => ({ name: each.name, text: new TextDecoder().decode(each.bytes) })),
          imageNames: images.map((each) => each.name),
          references,
        });
        // Only a turn that starts with a reproduce running, asked by a session that may reproduce,
        // gets the tool, bound to this thread.
        const reproducing = !monitor && reproduces.running(id) && scopes.includes("threads:reproduce");
        // The agent's tools are `/mcp` itself, read-only, with a token that lives for this turn.
        // Forked into the service's scope, so stopping the server interrupts it and logs that.
        turn.fiber = yield* Effect.gen(function* () {
          const grant = yield* Effect.acquireRelease(auth.mintMcpToken("agent thread", { ttlMs: TURN_TOKEN_TTL_MS }), ({ session }) =>
            auth.revoke(session.id).pipe(Effect.ignore),
          );
          // A monitor's token isn't bound to the thread, so `propose_change` refuses it too.
          if (!monitor) {
            yield* Effect.acquireRelease(
              Effect.sync(() => turnSessions.set(grant.session.id, id)),
              () => Effect.sync(() => turnSessions.delete(grant.session.id)),
            );
          }
          if (reproducing) yield* reproduces.bind(grant.session.id, id);
          yield* driver
            .runTurn({
              systemPrompt: systemPrompt(monitor ? "monitor" : reproducing ? "reproduce" : "owner"),
              prompt,
              images: images.map((each) => ({ mimeType: each.mimeType, base64: Buffer.from(each.bytes).toString("base64") })),
              mcp: { url: `${yield* endpoint.baseUrl}/mcp`, token: grant.token },
              reproduce: reproducing,
              propose: !monitor,
              account: { label: account.label, model: monitor?.model ?? model ?? account.model, apiKey: account.apiKey },
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

  const startTurn = (id: string, text: string, options: TurnOptions) => begin(id, text, options, null);

  const queueTurn = Effect.fn("Threads.queueTurn")(function* (id: string, text: string, options: TurnOptions) {
    // What would refuse it later is refused now, while the owner is still looking.
    const account = yield* accounts.resolve(options.accountId).pipe(Effect.mapError((error) => new ThreadError({ reason: error.reason === "not_found" ? "account_not_found" : "log_unreadable" })));
    if (options.model !== undefined && !offersModel(account.driver, options.model)) return yield* new ThreadError({ reason: "model_not_offered" });
    const waiting = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* loadUnlocked(id);
        if (!running.has(id)) return false;
        if (queued.has(id)) return yield* new ThreadError({ reason: "queue_full" });
        const message = { text, at: yield* nowIso };
        queued.set(id, { message, options });
        yield* publish(id, { _tag: "Queued", message });
        return true;
      }),
    );
    return waiting ? { turnId: null } : yield* startTurn(id, text, options);
  });

  const cancelQueued = (id: string) => log.read(id).pipe(Effect.andThen(clearQueue(id, "cancelled", null)));

  const remove = Effect.fn("Threads.remove")(function* (id: string) {
    yield* lock.withPermits(1)(
      Effect.gen(function* () {
        yield* log.read(id);
        if (running.has(id)) return yield* new ThreadError({ reason: "turn_running" });
        if (reproduces.running(id) || reproduceStarting.has(id)) return yield* new ThreadError({ reason: "reproduce_running" });
        yield* attachments.removeThread(id).pipe(Effect.mapError(() => new ThreadError({ reason: "log_unreadable" })));
        yield* log.remove(id);
        yield* publish(id, { _tag: "ThreadDeleted" });
      }),
    );
  });

  const interrupt = Effect.fn("Threads.interrupt")(function* (id: string) {
    yield* clearQueue(id, "stopped", null);
    const fiber = running.get(id)?.fiber;
    if (fiber) yield* Fiber.interrupt(fiber);
  });

  const stopTurn = (id: string, turnId: string) =>
    Effect.suspend(() => {
      const turn = running.get(id);
      if (turn?.turnId !== turnId || !turn.fiber) return Effect.void;
      turn.yieldsToQueue = true;
      return Fiber.interrupt(turn.fiber);
    });

  const subscribe = (id: string) =>
    Stream.unwrap(
      lock.withPermits(1)(
        Effect.gen(function* () {
          // Loaded first: loading can log a turn the server stopped under, and that belongs in the
          // snapshot, not again on the stream. Holding the lock, nothing else is published between.
          const file = yield* loadUnlocked(id);
          const subscription = yield* PubSub.subscribe(events);
          const turn = running.get(id);
          const snapshot: ThreadEvent = {
            _tag: "Snapshot",
            detail: { thread: summary(file), items: file.items },
            partial: turn && turn.partial !== "" ? { turnId: turn.turnId, text: turn.partial } : null,
            queued: queued.get(id)?.message ?? null,
          };
          return Stream.make(snapshot).pipe(
            Stream.concat(
              Stream.fromSubscription(subscription).pipe(
                Stream.filter((entry) => entry.threadId === id),
                Stream.map((entry) => entry.event),
                Stream.takeUntil((event) => event._tag === "ThreadDeleted"),
              ),
            ),
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
    // Marked under the lock, so a delete can't land while `up` starts the container.
    const { packet, subject } = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        const found = yield* header(id);
        if (running.has(id)) return yield* new ThreadError({ reason: "turn_running" });
        reproduceStarting.add(id);
        return found;
      }),
    );
    yield* Effect.gen(function* () {
      const started = yield* reproduces.start(id, packet, jobIdOf(subject), network);
      yield* appendNow(id, (seq, at) => ({ _tag: "ReproduceStarted", seq, ...started, network, at }));
    }).pipe(Effect.ensuring(Effect.sync(() => reproduceStarting.delete(id))));
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

  const proposeChange = Effect.fn("Threads.proposeChange")(function* (sessionId: string, input: { readonly install: string; readonly changes: ProposeInput["changes"]; readonly reason: string }) {
    const id = turnSessions.get(sessionId);
    if (id === undefined) return yield* new ProposalError({ why: "Only a thread's turn can propose a change." });
    const { packet, subject } = yield* header(id).pipe(Effect.mapError(() => new ProposalError({ why: "Couldn't read this thread." })));
    const proposal = yield* proposals.propose({ ...input, threadId: id, runUrl: runUrlOf(packet, jobIdOf(subject)) });
    const turn = running.get(id);
    if (turn) yield* record(id, turn, (seq, at) => ({ _tag: "ChangeProposed", seq, turnId: turn.turnId, proposalId: proposal.id, at })).pipe(Effect.ignore);
    return proposal;
  });

  return Threads.of({ provider, harnesses, list, read, create, startTurn, queueTurn, cancelQueued, remove, interrupt, stopTurn, subscribe, checkReproduce, startReproduce, stopReproduce, reproduceExec, proposeChange });
});

export const layer = Layer.effect(Threads, make);
