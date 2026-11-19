import { RPC_METHODS } from "@runnerbox/contracts";

// What the composer and settings may offer on a server. `methods` is what the server says it answers, or null
// when it's older than being asked, which also means older than everything listed here. References
// travel inside a question rather than as a method, and every server that answers has them.
export type Capabilities = {
  readonly models: boolean;
  readonly attachments: boolean;
  readonly references: boolean;
  readonly queue: boolean;
  readonly deleteThread: boolean;
  // `providers.list` and `providers.save`, which carry drivers this app may not know.
  readonly providers: boolean;
  // `history.jobResources`: a job's steps, memory and CPU.
  readonly jobResources: boolean;
  // `runners.subscribeQueue`: the jobs GitHub has queued for this machine's runners.
  readonly waitingJobs: boolean;
  // `server.update`: the server updates itself, so the app offers Update instead of a command.
  readonly serverUpdate: boolean;
  // `history.kindUsage` and `history.jobTrends`: Speed and cost's questions.
  readonly speed: boolean;
  // `server.checkRelease`: the server can say whether a release is signed before Update is offered.
  readonly checkRelease: boolean;
  // `runners.restartStatus` and `runners.restartWhenIdle`: About can restart an install's runners.
  readonly restartRunners: boolean;
  // `reviews.status`: the Pull requests page and its settings.
  readonly reviews: boolean;
  // `reviews.start` and `reviews.read`: the server reviews a pull request and keeps what it found.
  readonly reviewRuns: boolean;
  // `github.status` and `github.signIn`: the server signs in to GitHub through the shared App.
  readonly github: boolean;
  // `moveCi.status`: where each repository's jobs pick their runner, and the patch that moves them.
  readonly moveCi: boolean;
  // `moveCi.setRunner`: the switch that sets a repository's runner variable.
  readonly moveCiSwitch: boolean;
  // `history.whereRan`: the runs bar beside each repository in Where CI runs.
  readonly whereRan: boolean;
  // `moveCi.subscribe`: the server pushes Move CI's view when it changes, rather than being asked.
  readonly moveCiPush: boolean;
  // `reviews.subscribe`: the server pushes the reviews view when it changes, rather than being asked.
  readonly reviewsPush: boolean;
  // `github.subscribe`: the server pushes its GitHub sign-in status when it changes, rather than being asked.
  readonly githubPush: boolean;
};

export const NO_CAPABILITIES: Capabilities = { models: false, attachments: false, references: false, queue: false, deleteThread: false, providers: false, jobResources: false, waitingJobs: false, serverUpdate: false, speed: false, checkRelease: false, restartRunners: false, reviews: false, reviewRuns: false, github: false, moveCi: false, moveCiSwitch: false, whereRan: false, moveCiPush: false, reviewsPush: false, githubPush: false };

export function capabilitiesOf(methods: ReadonlyArray<string> | null): Capabilities {
  if (methods === null) return NO_CAPABILITIES;
  const has = (method: string) => methods.includes(method);
  return {
    models: has(RPC_METHODS.threadsHarnesses),
    attachments: has(RPC_METHODS.threadsStageAttachment) && has(RPC_METHODS.threadsAttachmentChunk),
    references: true,
    queue: has(RPC_METHODS.threadsQueueTurn) && has(RPC_METHODS.threadsCancelQueued),
    deleteThread: has(RPC_METHODS.threadsDelete),
    providers: has(RPC_METHODS.providersList) && has(RPC_METHODS.providersSave),
    jobResources: has(RPC_METHODS.historyJobResources),
    waitingJobs: has(RPC_METHODS.runnersSubscribeQueue),
    serverUpdate: has(RPC_METHODS.serverUpdate) && has(RPC_METHODS.serverUpdateStatus),
    speed: has(RPC_METHODS.historyKindUsage) && has(RPC_METHODS.historyJobTrends),
    checkRelease: has(RPC_METHODS.serverCheckRelease),
    restartRunners: has(RPC_METHODS.runnersRestartStatus) && has(RPC_METHODS.runnersRestartWhenIdle),
    reviews: has(RPC_METHODS.reviewsStatus),
    reviewRuns: has(RPC_METHODS.reviewsStart) && has(RPC_METHODS.reviewsRead),
    github: has(RPC_METHODS.githubStatus) && has(RPC_METHODS.githubSignIn),
    moveCi: has(RPC_METHODS.moveCiStatus),
    moveCiSwitch: has(RPC_METHODS.moveCiSetRunner),
    whereRan: has(RPC_METHODS.historyWhereRan),
    moveCiPush: has(RPC_METHODS.moveCiSubscribe),
    reviewsPush: has(RPC_METHODS.reviewsSubscribe),
    githubPush: has(RPC_METHODS.githubSubscribe),
  };
}
