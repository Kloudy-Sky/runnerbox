import { type ResolvedReference, ThreadError, type ThreadItem, type ThreadReference } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import { subjectPacket } from "./subjectPacket.ts";
import type * as ThreadLog from "./ThreadLog.ts";

// A referenced thread brings what its agent found, newest kept when it's long, never its tools,
// proposals or reproduce.
export const MAX_FINDINGS_CHARS = 8_000;

const findings = (items: ReadonlyArray<ThreadItem>) => {
  const texts = items.flatMap((item) => (item._tag === "AgentText" ? [item.text] : []));
  const kept: string[] = [];
  let used = 0;
  for (const text of texts.toReversed()) {
    if (used + text.length > MAX_FINDINGS_CHARS) break;
    kept.unshift(text);
    used += text.length;
  }
  return { findings: kept, leftOut: texts.length - kept.length };
};

// Reads what a reference says now, to be logged with the question. The packet is JSON, so names
// and findings stay quoted data.
export const resolveReference = Effect.fn("resolveReference")(function* (read: ReturnType<typeof ThreadLog.make>["read"], selfId: string, ref: ThreadReference) {
  if (ref._tag === "thread") {
    if (ref.id === selfId) return yield* new ThreadError({ reason: "reference_self" });
    const file = yield* read(ref.id).pipe(Effect.mapError((error) => (error.reason === "thread_not_found" ? new ThreadError({ reason: "reference_not_found" }) : error)));
    const packet = JSON.stringify({ referenced: "thread", title: file.header.title, subject: file.header.subject, ...findings(file.items) });
    return { ref, title: file.header.title, packet } satisfies ResolvedReference;
  }
  const { title, packet } = yield* subjectPacket({ _tag: "run", repo: ref.repo, jobId: ref.jobId }, ref.days).pipe(
    Effect.mapError((error) => (error.reason === "subject_not_found" ? new ThreadError({ reason: "reference_not_found" }) : error)),
  );
  return { ref, title, packet } satisfies ResolvedReference;
});
