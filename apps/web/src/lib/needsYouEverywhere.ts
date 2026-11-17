import type { Inbox, InboxItem } from "@runnerbox/contracts";

// Kinds built from a repository's jobs. Two machines that sync the same repository report the same
// one under the same id. Every other kind comes from one machine's own runners and labels, and its
// id (`no_runner:needs_you`, `failing_slot:<install>:<kind>`) can repeat on another machine while
// meaning something else there.
const SHARED_KINDS: ReadonlySet<InboxItem["kind"]> = new Set(["failure", "slow_job"]);

// What needs the owner across every machine. A shared item counts once, as the machine that saw it
// last tells it; a machine's own item always counts. A machine with no answer yet, or offline, adds
// nothing and hides nothing.
export function needsYouEverywhere(answers: ReadonlyArray<{ readonly environmentId: string; readonly inbox: Inbox | undefined }>) {
  const byKey = new Map<string, InboxItem>();
  for (const { environmentId, inbox } of answers) {
    for (const item of inbox?.items ?? []) {
      const key = SHARED_KINDS.has(item.kind) ? item.id : `${environmentId}\0${item.id}`;
      const held = byKey.get(key);
      if (!held || Date.parse(item.at) > Date.parse(held.at)) byKey.set(key, item);
    }
  }
  return [...byKey.values()];
}
