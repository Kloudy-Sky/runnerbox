import { Attempt } from "@runnerbox/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as StateLogs from "../history/StateLogs.ts";

// What a reproduce of a thread's subject runs: the failed attempt from the evidence the thread
// started from, on the install and kind whose runner ran it. `image` is the tag that runner
// recorded, and nothing else: a client or the agent never names the image, so a reproduce can
// only run on what the job itself ran on, or the kind's current image when that's gone.
export type ReproduceTarget = {
  readonly _tag: "Target";
  readonly install: string;
  readonly kind: string;
  readonly repo: string;
  readonly commit: string;
  readonly image: string | null;
};

// The thread's packet is JSON this server wrote; only the fields a reproduce needs are read back.
const Packet = Schema.Struct({
  repo: Schema.optionalKey(Schema.NullOr(Schema.String)),
  evidence: Schema.Struct({ attempts: Schema.Array(Attempt) }),
});
const decodePacket = Schema.decodeUnknownEffect(Schema.fromJsonString(Packet));

// Runner events older than this have usually been pruned by `up` anyway.
const LOOKBACK_MS = 90 * 24 * 60 * 60_000;
const COMMIT = /^[0-9a-f]{40}$/;

export type NotReady = { readonly _tag: "NotReady"; readonly why: string };
const notReady = (why: string): Effect.Effect<NotReady> => Effect.succeed({ _tag: "NotReady", why });

// The attempt to rerun: the job a run thread is about, or the last failed attempt of an item.
export const reproduceTarget = Effect.fn("reproduceTarget")(function* (packet: string, jobId: number | null): Effect.fn.Return<ReproduceTarget | NotReady, never, StateLogs.StateLogs> {
  const parsed = yield* decodePacket(packet).pipe(Effect.option);
  if (parsed._tag === "None") return yield* notReady("This thread's evidence doesn't name a job to rerun.");
  const { repo, evidence } = parsed.value;
  const ran = evidence.attempts.filter((attempt) => attempt.runner !== null);
  const attempt = jobId !== null ? ran.find((candidate) => candidate.jobId === jobId) : (ran.findLast((candidate) => candidate.conclusion === "failure") ?? ran.at(-1));
  if (!attempt || !repo) return yield* notReady("This thread has no job attempt that ran on a runner.");
  if (!attempt.headSha || !COMMIT.test(attempt.headSha)) return yield* notReady("The job's commit wasn't recorded, so its files can't be fetched.");
  const logs = yield* StateLogs.StateLogs;
  const events = yield* logs.events((yield* Clock.currentTimeMillis) - LOOKBACK_MS).pipe(Effect.orElseSucceed(() => []));
  const runner = events.find((event) => event.event === "runner" && event.runner === attempt.runner);
  if (runner?.event !== "runner" || !runner.runnerType) return yield* notReady("This job didn't run on one of this machine's runners.");
  return { _tag: "Target", install: runner.install, kind: runner.runnerType, repo, commit: attempt.headSha, image: runner.image ?? null } satisfies ReproduceTarget;
});
