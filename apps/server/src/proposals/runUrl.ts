import { Attempt } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// Only the fields of a thread's packet that name its run; the packet is JSON this server wrote.
const Packet = Schema.Struct({ repo: Schema.optionalKey(Schema.NullOr(Schema.String)), evidence: Schema.Struct({ attempts: Schema.Array(Attempt) }) });
const decodePacket = Schema.decodeUnknownOption(Schema.fromJsonString(Packet));

// The run on GitHub that a thread's evidence came from, where the owner can rerun it: the job a
// run thread is about, or an item's last failed attempt. Null when the packet names none.
export function runUrlOf(packet: string, jobId: number | null) {
  return decodePacket(packet).pipe(
    Option.flatMap(({ repo, evidence }) => {
      const attempt = jobId !== null ? evidence.attempts.find((candidate) => candidate.jobId === jobId) : (evidence.attempts.findLast((candidate) => candidate.conclusion === "failure") ?? evidence.attempts.at(-1));
      return repo && attempt ? Option.some(`https://github.com/${repo}/actions/runs/${attempt.runId}`) : Option.none();
    }),
    Option.getOrNull,
  );
}
