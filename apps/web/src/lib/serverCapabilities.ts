import { RPC_METHODS } from "@runnerbox/contracts";

// What the composer may offer on a server. `methods` is what the server says it answers, or null
// when it's older than being asked, which also means older than everything listed here. References
// travel inside a question rather than as a method, and every server that answers has them.
export type Capabilities = {
  readonly models: boolean;
  readonly attachments: boolean;
  readonly references: boolean;
  readonly queue: boolean;
  readonly deleteThread: boolean;
};

export const NO_CAPABILITIES: Capabilities = { models: false, attachments: false, references: false, queue: false, deleteThread: false };

export function capabilitiesOf(methods: ReadonlyArray<string> | null): Capabilities {
  if (methods === null) return NO_CAPABILITIES;
  const has = (method: string) => methods.includes(method);
  return {
    models: has(RPC_METHODS.threadsHarnesses),
    attachments: has(RPC_METHODS.threadsStageAttachment) && has(RPC_METHODS.threadsAttachmentChunk),
    references: true,
    queue: has(RPC_METHODS.threadsQueueTurn) && has(RPC_METHODS.threadsCancelQueued),
    deleteThread: has(RPC_METHODS.threadsDelete),
  };
}
