import { type Evidence, inboxItems, ThreadError, type ThreadSubject } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { machineLookup } from "../history/machineLookup.ts";
import * as StateLogs from "../history/StateLogs.ts";
import * as Inbox from "../inbox/Inbox.ts";
import { runEvidence } from "../inbox/rules.ts";
import * as RunnerState from "../runners/RunnerState.ts";

const DAY_MS = 24 * 60 * 60_000;
// A long history adds tokens to every turn and says little more than its last few points.
const KEEP_DURATIONS = 20;

const compact = (evidence: Evidence) => ({ ...evidence, durations: evidence.durations.slice(-KEEP_DURATIONS) });

// What a thread starts from, taken once when it's created so later turns see the same evidence
// even after the item leaves the inbox. The packet is JSON, so names in it stay quoted data.
export const subjectPacket = Effect.fn("subjectPacket")(function* (subject: ThreadSubject, days: number) {
  const missing = new ThreadError({ reason: "subject_not_found" });
  const unreadable = () => new ThreadError({ reason: "log_unreadable" });
  if (subject._tag === "inbox") {
    const inbox = yield* Inbox.Inbox;
    const item = inboxItems(yield* inbox.list(days).pipe(Effect.mapError(unreadable))).find((candidate) => candidate.id === subject.itemId);
    if (!item) return yield* missing;
    const { evidence, id: _id, ...rest } = item;
    return { title: item.title, packet: JSON.stringify({ subject: "inbox item", ...rest, ruleVerdict: item.verdict, evidence: compact(evidence) }) };
  }
  const logs = yield* StateLogs.StateLogs;
  const runners = yield* RunnerState.RunnerState;
  const now = yield* Clock.currentTimeMillis;
  const since = now - days * DAY_MS;
  const found = yield* Effect.gen(function* () {
    return runEvidence(subject.jobId, {
      now,
      jobs: yield* logs.jobs(subject.repo, since),
      machine: machineLookup(yield* logs.samples(since)),
      events: yield* logs.events(since),
      installs: yield* runners.current,
    });
  }).pipe(Effect.mapError(unreadable));
  if (!found) return yield* missing;
  const { job } = found;
  return {
    title: found.title,
    packet: JSON.stringify({
      subject: "job attempt",
      repo: job.repo,
      workflow: job.workflow,
      job: job.job,
      branch: job.branch,
      conclusion: job.conclusion,
      runner: job.runner,
      labels: job.labels,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      ruleVerdict: found.verdict,
      evidence: compact(found.evidence),
    }),
  };
});
