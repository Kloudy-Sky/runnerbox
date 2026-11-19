import { useEffect, useState } from "react";
import { useActiveEnvironment } from "../../hooks/useEnvironment.ts";
import type { useInboxWrites } from "../../hooks/useInboxWrites.ts";
import type { ItemRow } from "../../lib/inboxRows.ts";
import { rowWhere } from "../../lib/inboxWords.ts";
import { cn } from "../../lib/utils.ts";
import { EnvironmentScope } from "../../state/environmentScope.ts";
import { type InboxMachine, monitorsAtom } from "../../state/inbox.ts";
import { appAtomRegistry } from "../../rpc/atomRegistry.ts";
import { runtime } from "../../runtime.ts";
import { ItemEvidence } from "../ItemEvidence.tsx";
import { Reading } from "../Reading.tsx";
import { ThreadColumn } from "../ThreadColumn.tsx";
import { Button } from "../ui/button.tsx";
import { Collapsible, CollapsiblePanel } from "../ui/collapsible.tsx";
import { FreeMemoryProof } from "./FreeMemoryProof.tsx";
import { InboxActions } from "./InboxActions.tsx";

// The item's thread lives on one machine: the switcher's, when it reports the item, so a thread
// already started there carries on; otherwise the machine that saw it last.
function threadMachine(row: ItemRow, activeId: string | undefined) {
  return row.copies.find((copy) => copy.environmentId === activeId)?.environmentId ?? row.newestOn;
}

// Each machine measures only its own memory, so the proof comes from a copy that holds samples,
// the newest one's first, read on the machine that sent it.
function memoryCopy(row: ItemRow) {
  const measured = row.copies.filter(({ item }) => item.kind === "failure" && item.verdict === "infra" && (item.evidence.machine?.samples ?? 0) > 0);
  return measured.find((copy) => copy.environmentId === row.newestOn) ?? measured[0];
}

// The opened item: what it costs, its title, what happened, why it's the owner's and the fix, the
// buttons, then the proof, with its agent thread and composer under it on the item's machine.
export function InboxItemView({ row, machines, writes }: { row: ItemRow; machines: ReadonlyArray<InboxMachine>; writes: ReturnType<typeof useInboxWrites> }) {
  // The machine the switcher shows, which is the first saved one until the owner picks.
  const environmentId = threadMachine(row, useActiveEnvironment().environment?.environmentId);
  const label = machines.find((machine) => machine.environmentId === environmentId)?.label ?? "";
  const [open, setOpen] = useState<"runs" | "detail" | null>(null);
  const { item } = row;
  // Opening an item a monitor looked into reads what it left, on each machine that looked, so its
  // "Answer ready" goes. Joined, so the effect runs when the set changes rather than every render.
  const unreadOn = row.copies
    .filter((copy) => machines.some((machine) => machine.environmentId === copy.environmentId && machine.monitors?.unread.includes(item.id)))
    .map((copy) => copy.environmentId)
    .join("\n");
  useEffect(() => {
    for (const machine of unreadOn.split("\n").filter(Boolean)) {
      runtime.run(machine, (client) => client["monitors.markRead"]({ itemId: item.id })).then(
        () => appAtomRegistry.refresh(monitorsAtom(machine)),
        () => undefined,
      );
    }
  }, [item.id, unreadOn]);
  const runs = item.evidence.attempts.length;
  const memory = memoryCopy(row);
  const where = rowWhere(row, label);
  return (
    <EnvironmentScope value={environmentId}>
      <ThreadColumn key={`${environmentId}:${item.id}`} subject={{ _tag: "inbox", itemId: item.id }} placeholder="Ask about this">
        {(thread) => (
          <Reading.Root className="gap-4">
            <Reading.Header>
              <div className={cn("font-medium text-xs", item.cost?.level === "blocking" ? "text-destructive" : "text-muted-foreground")}>{[item.cost?.text, where].filter(Boolean).join(" · ")}</div>
              <Reading.Title>{item.title}</Reading.Title>
            </Reading.Header>
            <dl className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
              <dt className="text-muted-foreground">What happened</dt>
              <dd className="pb-1">{item.happened}</dd>
              <dt className="text-muted-foreground">Why it's yours</dt>
              <dd className="pb-1">{item.why}</dd>
              <dt className="text-muted-foreground">The fix</dt>
              <dd>{item.action}</dd>
            </dl>
            <InboxActions row={row} writes={writes} thread={thread} />
            <section className="flex flex-col gap-1 pt-2">
              <h2 className="text-muted-foreground text-xs">The proof</h2>
              {memory ? (
                <EnvironmentScope value={memory.environmentId}>
                  <FreeMemoryProof item={memory.item} />
                </EnvironmentScope>
              ) : null}
              <div className="flex flex-wrap gap-1">
                {runs > 0 ? (
                  <Button variant="ghost-muted" size="xs" aria-expanded={open === "runs"} onClick={() => setOpen(open === "runs" ? null : "runs")}>
                    {runs === 1 ? "The run" : `The ${runs} runs`}
                  </Button>
                ) : null}
                <Button variant="ghost-muted" size="xs" aria-expanded={open === "detail"} onClick={() => setOpen(open === "detail" ? null : "detail")}>
                  Technical detail
                </Button>
              </div>
              <Collapsible open={open === "runs"}>
                <CollapsiblePanel>
                  <ItemEvidence item={item} />
                </CollapsiblePanel>
              </Collapsible>
              <Collapsible open={open === "detail"}>
                <CollapsiblePanel>
                  <ul className="flex flex-col gap-1 pt-2 font-mono text-[11.5px] text-muted-foreground">
                    {item.evidence.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                    <li>{[item.kind, item.verdict, label].filter(Boolean).join(" · ")}</li>
                  </ul>
                </CollapsiblePanel>
              </Collapsible>
            </section>
          </Reading.Root>
        )}
      </ThreadColumn>
    </EnvironmentScope>
  );
}
