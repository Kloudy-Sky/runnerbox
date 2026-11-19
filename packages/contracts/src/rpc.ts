import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import { AuthorizationError, type AuthScope, AuthScope as AuthScopeSchema, PairingCode, SessionSummary } from "./auth.ts";
import { DayTotals, Days, GroupBy, JobRun, JobSummary, Overview, RepoName, RepoRuns, StepComparison, WeeklySummary } from "./history.ts";
import { GitHubError, GitHubStatus } from "./github.ts";
import { Inbox, InboxItemId, InboxStateError, Instant } from "./inbox.ts";
import { MachineHealth } from "./health.ts";
import { JobResources } from "./resources.ts";
import { JobTrend, KindUsageReport } from "./usage.ts";
import { InstallName, InstallState, LauncherEvent, MachineSample, RunnerRestart, RunnerRestartError } from "./runners.ts";
import { QueueView } from "./queue.ts";
import { RunnersExplained } from "./runnersExplained.ts";
import { ATTACHMENT_LIMITS, AttachmentChunk, AttachmentError, AttachmentId, ChunkReceived, StageAttachment } from "./attachments.ts";
import { Account, AccountError, AccountId, EffortName, Harness, ModelName, SaveAccount } from "./accounts.ts";
import { Provider, ProviderAccount, SaveProviderAccount } from "./providers.ts";
import { ApplyWhen, Proposal, ProposalError, ProposalList } from "./proposals.ts";
import { MonitorError, MonitorSettings, MonitorStatus } from "./monitors.ts";
import { MoveCiError, MoveCiView, RunnerLabel, RunnerVariable } from "./moveCi.ts";
import { PullNumber, PullReviews, Review, ReviewError, ReviewsView } from "./reviews.ts";
import { ReleaseCheck, ReleaseVersion, ServerUpdateError, UpdateProgress, UpdateStatus } from "./update.ts";
import { CreateThread, MAX_REFERENCES, MessageText, ThreadReference, ProviderStatus, ReproduceCheck, ReproduceError, ReproduceNetwork, ThreadDetail, ThreadError, ThreadEvent, ThreadSubject, ThreadSummary } from "./threads.ts";

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
const TurnFailure = Schema.Union([AuthorizationError, ThreadError, AttachmentError]);
const AttachmentFailure = Schema.Union([AuthorizationError, AttachmentError]);
const ReproduceFailure = Schema.Union([AuthorizationError, ThreadError, ReproduceError]);
const ProposalFailure = Schema.Union([AuthorizationError, ProposalError]);
const ReviewFailure = Schema.Union([AuthorizationError, ReviewError]);
const GitHubFailure = Schema.Union([AuthorizationError, GitHubError]);
const InboxStateFailure = Schema.Union([AuthorizationError, InboxStateError]);
const ProposalId = { id: Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/)) };
const ThreadId = { id: Schema.String };
const TurnPayload = {
  ...ThreadId,
  text: MessageText,
  accountId: Schema.optionalKey(AccountId),
  model: Schema.optionalKey(ModelName),
  effort: Schema.optionalKey(EffortName),
  attachments: Schema.optionalKey(Schema.Array(AttachmentId).check(Schema.isMaxLength(ATTACHMENT_LIMITS.perMessage))),
  references: Schema.optionalKey(Schema.Array(ThreadReference).check(Schema.isMaxLength(MAX_REFERENCES))),
};
// A question as `threads.startTurn` and `threads.queueTurn` take it.
export const TurnRequest = Schema.Struct(TurnPayload);
export type TurnRequest = typeof TurnRequest.Type;
const Window = { repo: RepoName, days: Days };

export const RPC_METHODS = {
  historyRepos: "history.repos",
  historyOverview: "history.overview",
  historyJobSummaries: "history.jobSummaries",
  historyStepComparison: "history.stepComparison",
  historyRuns: "history.runs",
  historyWeeklySummary: "history.weeklySummary",
  historyJobResources: "history.jobResources",
  historyKindUsage: "history.kindUsage",
  historyJobTrends: "history.jobTrends",
  historyDailyTotals: "history.dailyTotals",
  historyWhereRan: "history.whereRan",
  inboxList: "inbox.list",
  inboxSettle: "inbox.settle",
  inboxUnsettle: "inbox.unsettle",
  inboxSnooze: "inbox.snooze",
  inboxWake: "inbox.wake",
  runnersEvents: "runners.events",
  runnersSamples: "runners.samples",
  runnersState: "runners.state",
  runnersSubscribeState: "runners.subscribeState",
  runnersSubscribeQueue: "runners.subscribeQueue",
  runnersExplain: "runners.explain",
  runnersHealth: "runners.health",
  accessSessions: "access.sessions",
  accessCreatePairingCode: "access.createPairingCode",
  accessRevokeSession: "access.revokeSession",
  threadsProvider: "threads.provider",
  threadsHarnesses: "threads.harnesses",
  threadsList: "threads.list",
  threadsRead: "threads.read",
  threadsCreate: "threads.create",
  threadsStartTurn: "threads.startTurn",
  threadsInterrupt: "threads.interrupt",
  threadsQueueTurn: "threads.queueTurn",
  threadsCancelQueued: "threads.cancelQueued",
  threadsDelete: "threads.delete",
  threadsStageAttachment: "threads.stageAttachment",
  threadsAttachmentChunk: "threads.attachmentChunk",
  threadsDiscardAttachment: "threads.discardAttachment",
  threadsAttachment: "threads.attachment",
  threadsSubscribe: "threads.subscribe",
  threadsCheckReproduce: "threads.checkReproduce",
  threadsStartReproduce: "threads.startReproduce",
  threadsStopReproduce: "threads.stopReproduce",
  accountsList: "accounts.list",
  accountsSave: "accounts.save",
  accountsRemove: "accounts.remove",
  accountsSetDefault: "accounts.setDefault",
  providersList: "providers.list",
  providersSave: "providers.save",
  serverAbout: "server.about",
  serverMethods: "server.methods",
  serverUpdateStatus: "server.updateStatus",
  serverUpdate: "server.update",
  serverCheckRelease: "server.checkRelease",
  runnersRestartStatus: "runners.restartStatus",
  runnersRestartWhenIdle: "runners.restartWhenIdle",
  proposalsList: "proposals.list",
  proposalsApprove: "proposals.approve",
  proposalsDecline: "proposals.decline",
  proposalsRevert: "proposals.revert",
  monitorsStatus: "monitors.status",
  monitorsSave: "monitors.save",
  monitorsMarkRead: "monitors.markRead",
  githubStatus: "github.status",
  githubSignIn: "github.signIn",
  githubCancelSignIn: "github.cancelSignIn",
  githubSignOut: "github.signOut",
  moveCiStatus: "moveCi.status",
  moveCiSetRunner: "moveCi.setRunner",
  moveCiSubscribe: "moveCi.subscribe",
  reviewsStatus: "reviews.status",
  reviewsSetRepo: "reviews.setRepo",
  reviewsSetModel: "reviews.setModel",
  reviewsRead: "reviews.read",
  reviewsStart: "reviews.start",
  reviewsStop: "reviews.stop",
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
  // One job attempt's steps, memory and CPU, and a sentence about them. Fails with a
  // StateReadError when the repo's log has no job with that ID.
  Rpc.make(RPC_METHODS.historyJobResources, {
    payload: { repo: RepoName, jobId: Schema.Int },
    success: JobResources,
    error: ReadError,
  }),
  // Each runner kind over the window, across every repo: slots, how busy, waits, why jobs waited,
  // and a hosted-price estimate.
  Rpc.make(RPC_METHODS.historyKindUsage, { payload: { days: Days }, success: KindUsageReport, error: ReadError }),
  // Each job of one repo: typical time per day, and whether it has become slower.
  Rpc.make(RPC_METHODS.historyJobTrends, { payload: Window, success: Schema.Array(JobTrend), error: ReadError }),
  // One row per UTC date the window touches, oldest first, over every repo or the one named.
  Rpc.make(RPC_METHODS.historyDailyTotals, { payload: { days: Days, repo: Schema.optionalKey(RepoName) }, success: Schema.Array(DayTotals), error: ReadError }),
  // Where each repo with a job log ran its jobs over the window, for the runs bar in Where CI runs.
  Rpc.make(RPC_METHODS.historyWhereRan, { payload: { days: Days }, success: Schema.Array(RepoRuns), error: ReadError }),
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
  // Snooze and settle change only what the app shows for an item, never what runs. The next
  // inbox.list carries the item's new state.
  Rpc.make(RPC_METHODS.inboxSettle, { payload: { id: InboxItemId }, error: InboxStateFailure }),
  // Keeps an item in the list even after a later run fixed it, until it fails again.
  Rpc.make(RPC_METHODS.inboxUnsettle, { payload: { id: InboxItemId }, error: InboxStateFailure }),
  // Hides an item until `until`, or until it fails again. A time already past is refused.
  Rpc.make(RPC_METHODS.inboxSnooze, { payload: { id: InboxItemId, until: Instant }, error: InboxStateFailure }),
  // Ends a snooze now, and clears the "back" an ended snooze leaves.
  Rpc.make(RPC_METHODS.inboxWake, { payload: { id: InboxItemId }, error: InboxStateFailure }),
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
  // Jobs GitHub has queued for this machine's labels, now and whenever that changes. Watching it
  // is what makes the server poll GitHub, with the token report.env holds.
  Rpc.make(RPC_METHODS.runnersSubscribeQueue, { success: QueueView, stream: true }),
  // Each install's runners in plain words: what they're doing now and what happened in `days`.
  Rpc.make(RPC_METHODS.runnersExplain, { payload: { days: Days }, success: RunnersExplained, error: ReadError }),
  // Each install's health per day over the last `days`: whether it took jobs, telling off from
  // down, its lowest free VM memory, and its jobs. Kept by day after minute samples are gone.
  Rpc.make(RPC_METHODS.runnersHealth, { payload: { days: Days }, success: Schema.Array(MachineHealth), error: ReadError }),
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
  // Each driver, whether it can run here, and the models a turn may pick on it.
  Rpc.make(RPC_METHODS.threadsHarnesses, { success: Schema.Array(Harness), error: AuthorizationError }),
  Rpc.make(RPC_METHODS.threadsList, {
    payload: { subject: Schema.optionalKey(ThreadSubject) },
    success: Schema.Array(ThreadSummary),
    error: ThreadFailure,
  }),
  Rpc.make(RPC_METHODS.threadsRead, { payload: ThreadId, success: ThreadDetail, error: ThreadFailure }),
  Rpc.make(RPC_METHODS.threadsCreate, { payload: CreateThread, success: ThreadSummary, error: ThreadFailure }),
  // Returns once the question is logged; the answer arrives on the thread's stream.
  // Without `accountId`, the turn runs as the default account. Without `model`, on the account's.
  // Without `effort`, at the model's own default.
  // `attachments` are files this session staged; the turn claims them into the thread.
  // `references` are other threads and runs on this server, added to the prompt as data.
  Rpc.make(RPC_METHODS.threadsStartTurn, {
    payload: TurnPayload,
    success: Schema.Struct({ turnId: Schema.String }),
    error: TurnFailure,
  }),
  // The same question, but while a turn runs it waits, one per thread, and starts when that turn
  // ends. `turnId` is null while it waits.
  Rpc.make(RPC_METHODS.threadsQueueTurn, { payload: TurnPayload, success: Schema.Struct({ turnId: Schema.NullOr(Schema.String) }), error: TurnFailure }),
  // Drops the waiting question; the stream hands its text back.
  Rpc.make(RPC_METHODS.threadsCancelQueued, { payload: ThreadId, error: ThreadFailure }),
  // Removes the thread's log and attachments. Refused while a turn or a reproduce runs. Proposals
  // it made stay, naming it as history.
  Rpc.make(RPC_METHODS.threadsDelete, { payload: ThreadId, error: ThreadFailure }),
  // A file is staged in chunks of at most `ATTACHMENT_LIMITS.chunkBytes`, one call each, so a big
  // file never holds up the socket's other calls. The server reads its type from the bytes.
  Rpc.make(RPC_METHODS.threadsStageAttachment, { payload: StageAttachment, success: Schema.Struct({ id: Schema.String }), error: AttachmentFailure }),
  Rpc.make(RPC_METHODS.threadsAttachmentChunk, { payload: AttachmentChunk, success: ChunkReceived, error: AttachmentFailure }),
  Rpc.make(RPC_METHODS.threadsDiscardAttachment, { payload: { id: AttachmentId }, error: AttachmentFailure }),
  // A sent file's bytes, as base64 chunks, for showing it in the thread.
  Rpc.make(RPC_METHODS.threadsAttachment, { payload: { threadId: Schema.String, id: AttachmentId }, success: Schema.String, error: AttachmentFailure, stream: true }),
  Rpc.make(RPC_METHODS.threadsInterrupt, { payload: ThreadId, error: ThreadFailure }),
  Rpc.make(RPC_METHODS.threadsSubscribe, { payload: ThreadId, success: ThreadEvent, error: ThreadFailure, stream: true }),
  Rpc.make(RPC_METHODS.threadsCheckReproduce, { payload: ThreadId, success: ReproduceCheck, error: ReproduceFailure }),
  // The owner's click. The container's image is the one the job's runner recorded, never one a
  // client names. Its start is logged on the thread's stream.
  Rpc.make(RPC_METHODS.threadsStartReproduce, { payload: { ...ThreadId, network: ReproduceNetwork }, error: ReproduceFailure }),
  Rpc.make(RPC_METHODS.threadsStopReproduce, { payload: ThreadId, error: ReproduceFailure }),
  Rpc.make(RPC_METHODS.accountsList, { success: Schema.Array(Account), error: Schema.Union([AuthorizationError, AccountError]) }),
  Rpc.make(RPC_METHODS.accountsSave, { payload: SaveAccount, success: Account, error: Schema.Union([AuthorizationError, AccountError]) }),
  Rpc.make(RPC_METHODS.accountsRemove, { payload: { id: AccountId }, error: Schema.Union([AuthorizationError, AccountError]) }),
  Rpc.make(RPC_METHODS.accountsSetDefault, { payload: { id: AccountId }, error: Schema.Union([AuthorizationError, AccountError]) }),
  // Every driver with its accounts, for apps that read `driver` as an open ID. `accounts.list` keeps
  // its own shape for older apps. Removing an account or making it the default goes by ID alone, so
  // `accounts.remove` and `accounts.setDefault` serve every driver.
  Rpc.make(RPC_METHODS.providersList, { success: Schema.Array(Provider), error: Schema.Union([AuthorizationError, AccountError]) }),
  Rpc.make(RPC_METHODS.providersSave, { payload: SaveProviderAccount, success: ProviderAccount, error: Schema.Union([AuthorizationError, AccountError]) }),
  Rpc.make(RPC_METHODS.proposalsList, { success: ProposalList, error: ProposalFailure }),
  // The owner's approval of one exact proposal: `hash` is what the screen showed, and must match.
  Rpc.make(RPC_METHODS.proposalsApprove, { payload: { ...ProposalId, hash: Schema.String, when: ApplyWhen }, success: Proposal, error: ProposalFailure }),
  Rpc.make(RPC_METHODS.proposalsDecline, { payload: ProposalId, success: Proposal, error: ProposalFailure }),
  // Makes a new proposal that puts an applied one's previous values back, to approve like any other.
  Rpc.make(RPC_METHODS.proposalsRevert, { payload: ProposalId, success: Proposal, error: ProposalFailure }),
  Rpc.make(RPC_METHODS.monitorsStatus, { success: MonitorStatus, error: Schema.Union([AuthorizationError, MonitorError]) }),
  Rpc.make(RPC_METHODS.monitorsSave, { payload: MonitorSettings, success: MonitorStatus, error: Schema.Union([AuthorizationError, MonitorError]) }),
  // The owner opened the item's thread, so its "Looked into" mark goes.
  Rpc.make(RPC_METHODS.monitorsMarkRead, { payload: { itemId: Schema.String }, error: Schema.Union([AuthorizationError, MonitorError]) }),
  // Who the server is signed in to GitHub as, and where the App is installed.
  Rpc.make(RPC_METHODS.githubStatus, { success: GitHubStatus, error: GitHubFailure }),
  // Asks GitHub for a code and returns at once. The server waits for the owner to approve it, and status says when.
  Rpc.make(RPC_METHODS.githubSignIn, { success: GitHubStatus, error: GitHubFailure }),
  Rpc.make(RPC_METHODS.githubCancelSignIn, { success: GitHubStatus, error: GitHubFailure }),
  // Forgets the token. GitHub still lists the authorization until the owner revokes it there.
  Rpc.make(RPC_METHODS.githubSignOut, { success: GitHubStatus, error: GitHubFailure }),
  // Where each job on the repositories the App is installed on picks its runner, and the patch
  // that moves the ones that don't read a runner variable yet. Nothing is written to GitHub.
  Rpc.make(RPC_METHODS.moveCiStatus, { success: MoveCiView, error: GitHubFailure }),
  // The same view, now and whenever it changes: as a look reads GitHub, at most once a minute, or on a switch.
  Rpc.make(RPC_METHODS.moveCiSubscribe, { success: MoveCiView, error: GitHubFailure, stream: true }),
  // Sets the repository's runner variable to one of this machine's labels, or deletes it with null
  // so its jobs run on GitHub again. Only the variable is written; never code.
  Rpc.make(RPC_METHODS.moveCiSetRunner, {
    payload: { repo: RepoName, variable: RunnerVariable, label: Schema.NullOr(RunnerLabel) },
    success: MoveCiView,
    error: Schema.Union([AuthorizationError, GitHubError, MoveCiError]),
  }),
  // The repositories the App is installed on, and the open pull requests on the ones turned on.
  Rpc.make(RPC_METHODS.reviewsStatus, { success: ReviewsView, error: ReviewFailure }),
  Rpc.make(RPC_METHODS.reviewsSetRepo, { payload: { repo: RepoName, review: Schema.Boolean }, success: ReviewsView, error: ReviewFailure }),
  Rpc.make(RPC_METHODS.reviewsSetModel, { payload: { model: Schema.String.check(Schema.isMaxLength(60)) }, success: ReviewsView, error: ReviewFailure }),
  // A pull request's reviews as the server keeps them. Nothing here is posted to GitHub.
  Rpc.make(RPC_METHODS.reviewsRead, { payload: { repo: RepoName, number: PullNumber }, success: PullReviews, error: ReviewFailure }),
  // Starts a review of the pull request's newest commit and returns at once; the review fills in as it runs.
  Rpc.make(RPC_METHODS.reviewsStart, { payload: { repo: RepoName, number: PullNumber }, success: Review, error: ReviewFailure }),
  Rpc.make(RPC_METHODS.reviewsStop, { payload: { repo: RepoName, number: PullNumber }, success: Review, error: ReviewFailure }),
  // The methods this server answers, so a client offers only what will work. A server older than
  // this method refuses it as unknown, which tells the client as much.
  Rpc.make(RPC_METHODS.serverMethods, { success: Schema.Array(Schema.String), error: AuthorizationError }),
  // The same version facts the public descriptor gives, over whatever route the client uses.
  Rpc.make(RPC_METHODS.serverAbout, { success: Schema.Struct({ label: Schema.String, serverVersion: Schema.String, protocolVersion: Schema.Int }), error: AuthorizationError }),
  // Whether this server can update now, and how its last update went.
  Rpc.make(RPC_METHODS.serverUpdateStatus, { success: UpdateStatus, error: AuthorizationError }),
  // Moves this server to `version`, a newer release of the repository it was built from, and
  // restarts it there. A second call for the same version while one runs follows the same steps.
  Rpc.make(RPC_METHODS.serverUpdate, { payload: { version: ReleaseVersion }, success: UpdateProgress, error: Schema.Union([AuthorizationError, ServerUpdateError]), stream: true }),
  // Whether `version` can be installed from here: signed by a key this server trusts, or not
  // needing to be. It reads the release's checksum and signature, not runnerbox.js itself.
  Rpc.make(RPC_METHODS.serverCheckRelease, { payload: { version: ReleaseVersion }, success: ReleaseCheck, error: Schema.Union([AuthorizationError, ServerUpdateError]) }),
  // Whether an install's runners can be restarted from here, any restart waiting, and how the last ended.
  Rpc.make(RPC_METHODS.runnersRestartStatus, { payload: { install: InstallName }, success: RunnerRestart, error: Schema.Union([AuthorizationError, RunnerRestartError]) }),
  // The owner's click: the install restarts its runners at the first moment no job is running,
  // within 6 hours. The install decides when; nothing is forced.
  Rpc.make(RPC_METHODS.runnersRestartWhenIdle, { payload: { install: InstallName }, success: RunnerRestart, error: Schema.Union([AuthorizationError, RunnerRestartError]) }),
).middleware(RpcScopeAuthorization);

export type RpcMethod = RpcGroup.Rpcs<typeof RunnerboxRpcGroup>["_tag"];

// The scopes each method needs. The server checks them before any handler runs, and clients use
// them to hide what a session can't do. A new method fails to compile until it's listed here.
const HISTORY = ["history:read"] as const;
const RUNNERS = ["runners:read"] as const;
const ACCESS = ["access:write"] as const;
// The agent reads history and runner state through its tools, so a thread needs both as well.
const THREADS = ["history:read", "runners:read", "threads:operate"] as const;
const REPRODUCE = [...THREADS, "threads:reproduce"] as const;
export const RPC_SCOPES = {
  [RPC_METHODS.historyRepos]: HISTORY,
  [RPC_METHODS.historyOverview]: HISTORY,
  [RPC_METHODS.historyJobSummaries]: HISTORY,
  [RPC_METHODS.historyStepComparison]: HISTORY,
  [RPC_METHODS.historyRuns]: HISTORY,
  [RPC_METHODS.historyWeeklySummary]: HISTORY,
  // It reads the job's container readings and its runner's events alongside the job.
  [RPC_METHODS.historyJobResources]: ["history:read", "runners:read"],
  [RPC_METHODS.historyKindUsage]: ["history:read", "runners:read"],
  [RPC_METHODS.historyJobTrends]: HISTORY,
  // Reviews are already read with `history:read` (reviews.read), so their totals take the same
  // scope and none of the row is held back from a session that can read jobs.
  [RPC_METHODS.historyDailyTotals]: HISTORY,
  [RPC_METHODS.historyWhereRan]: HISTORY,
  // The inbox reads launcher events and samples alongside jobs.
  [RPC_METHODS.inboxList]: ["history:read", "runners:read"],
  // Anyone who may ask the agent about an item may snooze or settle it.
  [RPC_METHODS.inboxSettle]: ["threads:operate"],
  [RPC_METHODS.inboxUnsettle]: ["threads:operate"],
  [RPC_METHODS.inboxSnooze]: ["threads:operate"],
  [RPC_METHODS.inboxWake]: ["threads:operate"],
  [RPC_METHODS.runnersEvents]: RUNNERS,
  [RPC_METHODS.runnersSamples]: RUNNERS,
  [RPC_METHODS.runnersState]: RUNNERS,
  [RPC_METHODS.runnersSubscribeState]: RUNNERS,
  // Job names are history, and the labels come from runner state.
  [RPC_METHODS.runnersSubscribeQueue]: ["history:read", "runners:read"],
  // Its episodes say which jobs passed, from the job log.
  [RPC_METHODS.runnersExplain]: ["history:read", "runners:read"],
  // Jobs failed because of the machine are the job history's verdict.
  [RPC_METHODS.runnersHealth]: ["history:read", "runners:read"],
  [RPC_METHODS.accessSessions]: ACCESS,
  [RPC_METHODS.accessCreatePairingCode]: ACCESS,
  [RPC_METHODS.accessRevokeSession]: ACCESS,
  [RPC_METHODS.threadsProvider]: THREADS,
  [RPC_METHODS.threadsHarnesses]: THREADS,
  [RPC_METHODS.threadsList]: THREADS,
  [RPC_METHODS.threadsRead]: THREADS,
  [RPC_METHODS.threadsCreate]: THREADS,
  [RPC_METHODS.threadsStartTurn]: THREADS,
  [RPC_METHODS.threadsInterrupt]: THREADS,
  [RPC_METHODS.threadsQueueTurn]: THREADS,
  [RPC_METHODS.threadsCancelQueued]: THREADS,
  [RPC_METHODS.threadsDelete]: THREADS,
  // Storing files on the machine is part of running threads, which Connect and MCP never reach.
  [RPC_METHODS.threadsStageAttachment]: THREADS,
  [RPC_METHODS.threadsAttachmentChunk]: THREADS,
  [RPC_METHODS.threadsDiscardAttachment]: THREADS,
  [RPC_METHODS.threadsAttachment]: THREADS,
  [RPC_METHODS.threadsSubscribe]: THREADS,
  [RPC_METHODS.threadsCheckReproduce]: REPRODUCE,
  [RPC_METHODS.threadsStartReproduce]: REPRODUCE,
  [RPC_METHODS.threadsStopReproduce]: REPRODUCE,
  // Picking an account is part of running threads; changing one, or setting a key, manages access.
  [RPC_METHODS.accountsList]: THREADS,
  [RPC_METHODS.accountsSave]: ["access:write", "threads:operate"],
  [RPC_METHODS.accountsRemove]: ["access:write", "threads:operate"],
  [RPC_METHODS.accountsSetDefault]: ["access:write", "threads:operate"],
  [RPC_METHODS.providersList]: THREADS,
  [RPC_METHODS.providersSave]: ["access:write", "threads:operate"],
  // Public already: the descriptor says the same to anyone.
  [RPC_METHODS.serverAbout]: [],
  // Public already: which methods exist says nothing about any data.
  [RPC_METHODS.serverMethods]: [],
  // Replacing the server's code: only a device the owner paired by address or SSH holds this.
  // Connect sessions and MCP tokens never do, and a thread's agent turns are MCP tokens.
  [RPC_METHODS.serverUpdateStatus]: ACCESS,
  [RPC_METHODS.serverUpdate]: ACCESS,
  [RPC_METHODS.serverCheckRelease]: ACCESS,
  // Moving runners to code the owner already installed: the same bar as updating the server.
  [RPC_METHODS.runnersRestartStatus]: ACCESS,
  [RPC_METHODS.runnersRestartWhenIdle]: ACCESS,
  // Reading proposals is part of threads; deciding one changes how runners run.
  [RPC_METHODS.proposalsList]: THREADS,
  [RPC_METHODS.proposalsApprove]: [...THREADS, "changes:approve"],
  [RPC_METHODS.proposalsDecline]: [...THREADS, "changes:approve"],
  [RPC_METHODS.proposalsRevert]: [...THREADS, "changes:approve"],
  // Turning monitors on decides what the owner's subscription or key is spent on, as accounts do.
  [RPC_METHODS.monitorsStatus]: THREADS,
  [RPC_METHODS.monitorsSave]: ["access:write", "threads:operate"],
  [RPC_METHODS.monitorsMarkRead]: THREADS,
  // The account and where the App is installed say no more than the repositories reviews already list.
  [RPC_METHODS.githubStatus]: HISTORY,
  // A token that can read the owner's code and write to their pull requests manages access.
  [RPC_METHODS.githubSignIn]: ACCESS,
  [RPC_METHODS.githubCancelSignIn]: ACCESS,
  [RPC_METHODS.githubSignOut]: ACCESS,
  // Job names and their runners are history like a job's runs are.
  [RPC_METHODS.moveCiStatus]: HISTORY,
  [RPC_METHODS.moveCiSubscribe]: HISTORY,
  // Moving a repository's CI changes where its code runs, as which repositories are read does.
  [RPC_METHODS.moveCiSetRunner]: ACCESS,
  // Pull request titles, authors and branches are history like a job's are.
  [RPC_METHODS.reviewsStatus]: HISTORY,
  // Which repositories are read manages access.
  [RPC_METHODS.reviewsSetRepo]: ACCESS,
  [RPC_METHODS.reviewsSetModel]: ACCESS,
  [RPC_METHODS.reviewsRead]: HISTORY,
  // A review is an agent turn on the owner's account, so it takes what starting a thread's turn takes.
  [RPC_METHODS.reviewsStart]: THREADS,
  [RPC_METHODS.reviewsStop]: THREADS,
} as const satisfies Record<RpcMethod, ReadonlyArray<AuthScope>>;
