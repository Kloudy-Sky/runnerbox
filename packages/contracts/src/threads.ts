import * as Schema from "effect/Schema";
import { Days, RepoName } from "./history.ts";

// What a thread is about: one inbox item, or one job attempt from the run list.
export const InboxSubject = Schema.TaggedStruct("inbox", { itemId: Schema.String });
export const RunSubject = Schema.TaggedStruct("run", { repo: RepoName, jobId: Schema.Number });
export const ThreadSubject = Schema.Union([InboxSubject, RunSubject]);
export type ThreadSubject = typeof ThreadSubject.Type;

// Two subjects are the same when their keys are, which is how a view finds its thread.
export const subjectKey = (subject: ThreadSubject) =>
  subject._tag === "inbox" ? `inbox:${subject.itemId}` : `run:${subject.repo}:${subject.jobId}`;

// A turn ends once, in one of these ways. `interrupted` covers the user stopping it and the server
// stopping under it.
export const TurnOutcome = Schema.Literals(["completed", "interrupted", "failed"]);
export type TurnOutcome = typeof TurnOutcome.Type;

const at = Schema.String;
const seq = Schema.Int;

// What a thread's log holds after its first line, in order. `seq` counts from 1 in each thread.
// `accountId` is the account the turn ran as; older lines don't have it.
export const UserMessage = Schema.TaggedStruct("UserMessage", { seq, turnId: Schema.String, text: Schema.String, at, accountId: Schema.optionalKey(Schema.String) });
export const AgentText = Schema.TaggedStruct("AgentText", { seq, turnId: Schema.String, text: Schema.String, at });
// `input` is the call's arguments as compact JSON, shown as one dim line.
export const ToolCall = Schema.TaggedStruct("ToolCall", { seq, turnId: Schema.String, name: Schema.String, input: Schema.String, at });
export const TurnEnded = Schema.TaggedStruct("TurnEnded", {
  seq,
  turnId: Schema.String,
  outcome: TurnOutcome,
  message: Schema.NullOr(Schema.String),
  // What the provider estimated the turn cost, when it says.
  costUsd: Schema.NullOr(Schema.Number),
  at,
});
// A reproduce: a throwaway container on the job's image with its commit's files, which the owner
// starts and the agent runs commands in. `setup` keeps the network for the first command only.
export const ReproduceNetwork = Schema.Literals(["on", "setup"]);
export type ReproduceNetwork = typeof ReproduceNetwork.Type;
// `imageFallback` is true when the job's own image wasn't recorded or is gone, so the kind's
// current one is used.
export const ReproduceStarted = Schema.TaggedStruct("ReproduceStarted", {
  seq,
  kind: Schema.String,
  commit: Schema.String,
  image: Schema.String,
  imageFallback: Schema.Boolean,
  network: ReproduceNetwork,
  at,
});
// One command the agent ran in it, with the end of its output.
export const ReproduceCommand = Schema.TaggedStruct("ReproduceCommand", {
  seq,
  turnId: Schema.String,
  command: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
  timedOut: Schema.Boolean,
  output: Schema.String,
  truncated: Schema.Boolean,
  at,
});
export const ReproduceEnded = Schema.TaggedStruct("ReproduceEnded", { seq, reason: Schema.String, at });

export const ThreadItem = Schema.Union([UserMessage, AgentText, ToolCall, TurnEnded, ReproduceStarted, ReproduceCommand, ReproduceEnded]);
export type ThreadItem = typeof ThreadItem.Type;

export const ThreadSummary = Schema.Struct({
  id: Schema.String,
  subject: ThreadSubject,
  title: Schema.String,
  createdAt: at,
  lastAt: at,
  running: Schema.Boolean,
});
export type ThreadSummary = typeof ThreadSummary.Type;

export const ThreadDetail = Schema.Struct({ thread: ThreadSummary, items: Schema.Array(ThreadItem) });
export type ThreadDetail = typeof ThreadDetail.Type;

// A thread's stream: a snapshot first, then each item as it's logged. Text streams as deltas of the
// running turn, and its `AgentText` item replaces them. `partial` is the text streamed so far.
export const ThreadSnapshot = Schema.TaggedStruct("Snapshot", {
  detail: ThreadDetail,
  partial: Schema.NullOr(Schema.Struct({ turnId: Schema.String, text: Schema.String })),
});
export const AgentTextDelta = Schema.TaggedStruct("AgentTextDelta", { turnId: Schema.String, text: Schema.String });
export const ThreadEvent = Schema.Union([ThreadSnapshot, AgentTextDelta, UserMessage, AgentText, ToolCall, TurnEnded, ReproduceStarted, ReproduceCommand, ReproduceEnded]);
export type ThreadEvent = typeof ThreadEvent.Type;

// Whether the environment can run agent turns. The reason never carries account details.
export const ProviderStatus = Schema.Struct({
  provider: Schema.String,
  available: Schema.Boolean,
  fix: Schema.NullOr(Schema.String),
});
export type ProviderStatus = typeof ProviderStatus.Type;

export const CreateThread = Schema.Struct({
  subject: ThreadSubject,
  // The window an inbox item was listed in, to find it again.
  days: Days,
});

export class ThreadError extends Schema.TaggedError<ThreadError>()("ThreadError", {
  reason: Schema.Literals(["thread_not_found", "subject_not_found", "turn_running", "provider_unavailable", "log_unreadable", "account_not_found"]),
}) {
  override get message() {
    switch (this.reason) {
      case "thread_not_found":
        return "No thread has that ID.";
      case "subject_not_found":
        return "That item or run isn't in the logs any more.";
      case "turn_running":
        return "This thread already has a turn running.";
      case "provider_unavailable":
        return "No agent provider is available on this environment.";
      case "log_unreadable":
        return "Couldn't read or write the thread's log on the server.";
      case "account_not_found":
        return "That account doesn't exist any more. Pick another in the composer.";
    }
  }
}

// Whether a thread's subject can be reproduced: the failed attempt's kind and commit, or why not.
export const ReproduceCheck = Schema.Union([
  Schema.TaggedStruct("Ready", { kind: Schema.String, commit: Schema.String, imageRecorded: Schema.Boolean }),
  Schema.TaggedStruct("NotReady", { why: Schema.String }),
]);
export type ReproduceCheck = typeof ReproduceCheck.Type;

// `up` refused or couldn't do what was asked, in words meant for the owner.
export class ReproduceError extends Schema.TaggedError<ReproduceError>()("ReproduceError", { why: Schema.String }) {
  override get message() {
    return this.why;
  }
}

export const MAX_MESSAGE_LENGTH = 4000;
export const MessageText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MESSAGE_LENGTH));
