import type { InboxItem, Proposal } from "@runnerbox/contracts";

// The items, with `fix` on each that has an open proposal a rule wrote for it. Only reads, so
// listing the inbox never proposes; RuleFixes.ts writes them on the server's own schedule.
export function withFixes(items: ReadonlyArray<InboxItem>, proposals: ReadonlyArray<Proposal>): InboxItem[] {
  const open = new Map(proposals.flatMap((proposal) => (proposal.rule && proposal.status === "open" ? [[proposal.rule.itemId, proposal.id] as const] : [])));
  return items.map((item) => {
    const proposalId = open.get(item.id);
    return proposalId === undefined ? item : { ...item, fix: { proposalId } };
  });
}
