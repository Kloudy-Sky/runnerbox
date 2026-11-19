import { useAtomValue } from "@effect/atom-react";
import { inboxRows } from "../lib/inboxRows.ts";
import { inboxMachinesAtom } from "../state/inbox.ts";
import { useRange } from "./useRange.ts";

// The Inbox across every saved machine over the page's range: each machine's part of it, and the
// rows built from them.
export function useInboxEverywhere() {
  const { days } = useRange();
  const machines = useAtomValue(inboxMachinesAtom(days));
  return { machines, rows: inboxRows(machines), loaded: machines.some((machine) => machine.inbox !== undefined) };
}
