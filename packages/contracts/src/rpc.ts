import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { AuthorizationError, type AuthScope, AuthScope as AuthScopeSchema, PairingCode, SessionSummary } from "./auth.ts";
import { Days, GroupBy, JobRun, JobSummary, Overview, RepoName, StepComparison, WeeklySummary } from "./history.ts";
import { Inbox } from "./inbox.ts";
import { InstallState, LauncherEvent, MachineSample } from "./runners.ts";
import { CreateThread, MessageText, ProviderStatus, ThreadDetail, ThreadError, ThreadEvent, ThreadSubject, ThreadSummary } from "./threads.ts";

// A log under the state directory couldn't be read. The path stays on the server.
export class StateReadError extends Schema.TaggedError<StateReadError>()("StateReadError", {
  what: Schema.String,
}) {
  override get message() {
    return `Couldn't read ${this.what} on the server.`;
  }
}

export class AccessError extends Schema.TaggedError<AccessError>()("AccessError", {
  reason: Schema.Literals(["scope_not_held", "unknown_session"]),
}) {
  override get message() {
    return this.reason === "scope_not_held"
      ? "A pairing code can't grant a scope this session doesn't hold."
      : "No session has that ID.";
  }
}

const ReadError = Schema.Union([AuthorizationError, StateReadError]);
const ThreadFailure = Schema.Union([AuthorizationError, ThreadError]);
const ThreadId = { id: Schema.String };
const Window = { repo: RepoName, days: Days };

export const RPC_METHODS = {
  historyRepos: "history.repos",
  historyOverview: "history.overview",
  historyJobSummaries: "history.jobSummaries",
  historyStepComparison: "history.stepComparison",
  historyRuns: "history.runs",
  historyWeeklySummary: "history.weeklySummary",
  inboxList: "inbox.list",
  runnersEvents: "runners.events",
  runnersSamples: "runners.samples",
  runnersState: "runners.state",
  runnersSubscribeState: "runners.subscribeState",
  accessSessions: "access.sessions",
  accessCreatePairingCode: "access.createPairingCode",
  accessRevokeSession: "access.revokeSession",
  threadsProvider: "threads.provider",
  threadsList: "threads.list",
  threadsRead: "threads.read",
  threadsCreate: "threads.create",
  threadsStartTurn: "threads.startTurn",
  threadsInterrupt: "threads.interrupt",
  threadsSubscribe: "threads.subscribe",
} as const;

export class RpcScopeAuthorization extends RpcMiddleware.Service<RpcScopeAuthorization>()(
  "runnerbox/contracts/RpcScopeAuthorization",
  { error: AuthorizationError },
) {}

export const RunnerboxRpcGroup = RpcGroup.make(
  Rpc.make(RPC_METHODS.historyRepos, { success: Schema.Array(Schema.String), error: ReadError }),
  Rpc.make(RPC_METHODS.historyOverview, { payload: { days: Days }, success: Overview, error: ReadError }),
  Rpc.make(RPC_METHODS.historyJobSummaries, {
    payload: { ...Window, by: GroupBy, workflow: Schema.optionalKey(Schema.String) },
    success: Schema.Array(JobSummary),
    error: ReadError,
  }),
  Rpc.make(RPC_METHODS.historyStepComparison, {
    payload: { ...Window, job: Schema.String, by: GroupBy, workflow: Schema.optionalKey(Schema.String) },
    success: StepComparison,
    error: ReadError,
  }),
  Rpc.make(RPC_METHODS.historyRuns, {
    payload: { ...Window, limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5000 })) },
    success: Schema.Array(JobRun),
    error: ReadError,
  }),
  Rpc.make(RPC_METHODS.historyWeeklySummary, {
    payload: { ...Window, by: GroupBy },
    success: WeeklySummary,
    error: ReadError,
  }),
  Rpc.make(RPC_METHODS.inboxList, { payload: { days: Days }, success: Inbox, error: ReadError }),
  Rpc.make(RPC_METHODS.runnersEvents, {
    payload: { days: Days },
    success: Schema.Array(LauncherEvent),
    error: ReadError,
  }),
  // Samples come one a minute, so a long window is thinned to at most `maxPoints` per install,
  // keeping the sample with the least VM memory available in each stretch.
  Rpc.make(RPC_METHODS.runnersSamples, {
    payload: { days: Days, maxPoints: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 5000 })) },
    success: Schema.Array(MachineSample),
    error: ReadError,
  }),
  Rpc.make(RPC_METHODS.runnersState, { success: Schema.Array(InstallState), error: ReadError }),
  // Sends every install's state now, then again whenever it changes.
  Rpc.make(RPC_METHODS.runnersSubscribeState, { success: Schema.Array(InstallState), error: ReadError, stream: true }),
  Rpc.make(RPC_METHODS.accessSessions, { success: Schema.Array(SessionSummary), error: AuthorizationError }),
  Rpc.make(RPC_METHODS.accessCreatePairingCode, {
    payload: { scopes: Schema.Array(AuthScopeSchema) },
    success: PairingCode,
    error: Schema.Union([AuthorizationError, AccessError]),
  }),
  Rpc.make(RPC_METHODS.accessRevokeSession, {
    payload: { id: Schema.String },
    error: Schema.Union([AuthorizationError, AccessError]),
  }),
  Rpc.make(RPC_METHODS.threadsProvider, { success: ProviderStatus, error: AuthorizationError }),
  Rpc.make(RPC_METHODS.threadsList, {
    payload: { subject: Schema.optionalKey(ThreadSubject) },
    success: Schema.Array(ThreadSummary),
    error: ThreadFailure,
  }),
  Rpc.make(RPC_METHODS.threadsRead, { payload: ThreadId, success: ThreadDetail, error: ThreadFailure }),
  Rpc.make(RPC_METHODS.threadsCreate, { payload: CreateThread, success: ThreadSummary, error: ThreadFailure }),
  // Returns once the question is logged; the answer arrives on the thread's stream.
  Rpc.make(RPC_METHODS.threadsStartTurn, { payload: { ...ThreadId, text: MessageText }, success: Schema.Struct({ turnId: Schema.String }), error: ThreadFailure }),
  Rpc.make(RPC_METHODS.threadsInterrupt, { payload: ThreadId, error: ThreadFailure }),
  Rpc.make(RPC_METHODS.threadsSubscribe, { payload: ThreadId, success: ThreadEvent, error: ThreadFailure, stream: true }),
).middleware(RpcScopeAuthorization);

export type RpcMethod = RpcGroup.Rpcs<typeof RunnerboxRpcGroup>["_tag"];

// The scopes each method needs. The server checks them before any handler runs, and clients use
// them to hide what a session can't do. A new method fails to compile until it's listed here.
const HISTORY = ["history:read"] as const;
const RUNNERS = ["runners:read"] as const;
const ACCESS = ["access:write"] as const;
// The agent reads history and runner state through its tools, so a thread needs both as well.
const THREADS = ["history:read", "runners:read", "threads:operate"] as const;
export const RPC_SCOPES = {
  [RPC_METHODS.historyRepos]: HISTORY,
  [RPC_METHODS.historyOverview]: HISTORY,
  [RPC_METHODS.historyJobSummaries]: HISTORY,
  [RPC_METHODS.historyStepComparison]: HISTORY,
  [RPC_METHODS.historyRuns]: HISTORY,
  [RPC_METHODS.historyWeeklySummary]: HISTORY,
  // The inbox reads launcher events and samples alongside jobs.
  [RPC_METHODS.inboxList]: ["history:read", "runners:read"],
  [RPC_METHODS.runnersEvents]: RUNNERS,
  [RPC_METHODS.runnersSamples]: RUNNERS,
  [RPC_METHODS.runnersState]: RUNNERS,
  [RPC_METHODS.runnersSubscribeState]: RUNNERS,
  [RPC_METHODS.accessSessions]: ACCESS,
  [RPC_METHODS.accessCreatePairingCode]: ACCESS,
  [RPC_METHODS.accessRevokeSession]: ACCESS,
  [RPC_METHODS.threadsProvider]: THREADS,
  [RPC_METHODS.threadsList]: THREADS,
  [RPC_METHODS.threadsRead]: THREADS,
  [RPC_METHODS.threadsCreate]: THREADS,
  [RPC_METHODS.threadsStartTurn]: THREADS,
  [RPC_METHODS.threadsInterrupt]: THREADS,
  [RPC_METHODS.threadsSubscribe]: THREADS,
} as const satisfies Record<RpcMethod, ReadonlyArray<AuthScope>>;
