import type { Check, InboxItem, PullRequest } from "@runnerbox/contracts";

// The inbox item that says a pull request's failed check failed because of a machine, or null.
// Failure items are one per job and verdict, keyed `failure:<repo>\0<workflow>\0<job>:<verdict>`
// (apps/server/src/inbox/failures.ts), and must hold an attempt on the pull request's head commit,
// so an item about the same job on another commit never matches. A check with no workflow can't
// be matched by job, so it gets no item.
export function machineFailureFor(pull: PullRequest, check: Check, items: ReadonlyArray<InboxItem>) {
  if (check.state !== "failed" || check.workflow === null || pull.headSha === "") return null;
  const id = `failure:${pull.repo}\0${check.workflow}\0${check.name}:infra`;
  return items.find((item) => item.id === id && item.evidence.attempts.some((attempt) => attempt.headSha === pull.headSha)) ?? null;
}
