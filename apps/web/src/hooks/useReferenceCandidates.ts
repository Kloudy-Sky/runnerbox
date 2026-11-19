import { useAtomValue } from "@effect/atom-react";
import { answerOf } from "../lib/answer.ts";
import { referenceCandidatesAtom } from "../state/threads.ts";

// What `@` can refer to on this server: its other threads, newest first, then recent runs in each
// repo. Asked for only while the menu is open: closed, it reads no machine, which never asks.
export function useReferenceCandidates(environmentId: string, days: number, currentThreadId: string | null, open: boolean) {
  const candidates = answerOf(useAtomValue(referenceCandidatesAtom({ environmentId: open ? environmentId : "", days })));
  const items = (candidates.data ?? []).filter((candidate) => !(candidate.kind === "thread" && candidate.id === currentThreadId));
  return { items, loading: candidates.data === undefined && !candidates.isError, failed: candidates.isError };
}
