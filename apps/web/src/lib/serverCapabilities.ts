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
  // `runners.explain`: the Runners page in plain words. Without it, the page shows the raw records.
  readonly runnersExplained: boolean;
};

export const NO_CAPABILITIES: Capabilities = { models: false, attachments: false, references: false, queue: false, deleteThread: false, providers: false, jobResources: false, waitingJobs: false, serverUpdate: false, speed: false, runnersExplained: false };

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
    runnersExplained: has(RPC_METHODS.runnersExplain),
  };
}
