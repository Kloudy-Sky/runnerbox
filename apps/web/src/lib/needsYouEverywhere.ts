import type { Inbox, InboxItem } from "@runnerbox/contracts";

// What needs the owner across every machine. Two machines that sync the same repository report
// the same failure under the same id, so it counts once, as the machine that saw it last tells it.
// A machine with no answer yet, or offline, adds nothing and hides nothing.
export function needsYouEverywhere(inboxes: ReadonlyArray<Inbox | undefined>) {
  const byId = new Map<string, InboxItem>();
  for (const item of inboxes.flatMap((inbox) => inbox?.items ?? [])) {
    const held = byId.get(item.id);
    if (!held || Date.parse(item.at) > Date.parse(held.at)) byId.set(item.id, item);
  }
  return [...byId.values()];
}
