import type { RunnerboxClient } from "@runnerbox/client-runtime";
import { useQueryClient } from "@tanstack/react-query";
import type * as Effect from "effect/Effect";
import type { ItemRow } from "../lib/inboxRows.ts";
import { runtime } from "../runtime.ts";
import type { InboxMachine } from "./useInboxEverywhere.ts";

type Write = { readonly environmentId: string; readonly call: (client: RunnerboxClient) => Effect.Effect<unknown, unknown> };

// Snooze, settle and approve for an inbox row, sent to every machine that reports the item, so it
// holds on each. Every machine is tried; the first refusal is thrown after, for the caller to show.
export function useInboxWrites(machines: ReadonlyArray<InboxMachine>) {
  const queryClient = useQueryClient();
  const send = async (writes: ReadonlyArray<Write>, refresh: ReadonlyArray<string>) => {
    const results = await Promise.allSettled(writes.map(({ environmentId, call }) => runtime.run(environmentId, call)));
    await Promise.all(writes.flatMap(({ environmentId }) => refresh.map((key) => queryClient.invalidateQueries({ queryKey: [environmentId, key] }))));
    const refused = results.find((result) => result.status === "rejected");
    if (refused) throw refused.reason;
  };
  const toEach = (row: ItemRow, call: Write["call"]) => [...new Set(row.copies.map((copy) => copy.environmentId))].map((environmentId) => ({ environmentId, call }));
  // Each machine's rule wrote its own proposal for the item, so each copy approves its own.
  const fixesOf = (row: ItemRow) =>
    row.copies.flatMap(({ environmentId, item }) => {
      const answer = machines.find((machine) => machine.environmentId === environmentId)?.proposals;
      const proposal = answer?.proposals.find((each) => each.id === item.fix?.proposalId && each.status === "open");
      return proposal && answer?.canApprove ? [{ environmentId, proposal }] : [];
    });
  return {
    snooze: (row: ItemRow, until: string) => send(toEach(row, (client) => client["inbox.snooze"]({ id: row.item.id, until })), ["inbox"]),
    wake: (row: ItemRow) => send(toEach(row, (client) => client["inbox.wake"]({ id: row.item.id })), ["inbox"]),
    settle: (row: ItemRow) => send(toEach(row, (client) => client["inbox.settle"]({ id: row.item.id })), ["inbox"]),
    unsettle: (row: ItemRow) => send(toEach(row, (client) => client["inbox.unsettle"]({ id: row.item.id })), ["inbox"]),
    canApprove: (row: ItemRow) => fixesOf(row).length > 0,
    // Applied when no job is running, as the rule's own sentence says.
    approve: (row: ItemRow) =>
      send(
        fixesOf(row).map(({ environmentId, proposal }) => ({ environmentId, call: (client: RunnerboxClient) => client["proposals.approve"]({ id: proposal.id, hash: proposal.hash, when: "idle" }) })),
        ["proposals", "inbox"],
      ),
  };
}
