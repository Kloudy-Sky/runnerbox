import type { InboxItem } from "@runnerbox/contracts";
import { useState } from "react";
import { NoHistory } from "../components/NoHistory.tsx";
import { Stats } from "../components/Stats.tsx";
import { InboxEvidence } from "../components/InboxEvidence.tsx";
import { InboxTag } from "../components/InboxTag.tsx";
import { ThreadDock } from "../components/ThreadDock.tsx";
import { useInbox } from "../hooks/useInbox.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { listening, useRunnerState } from "../hooks/useRunnerState.ts";
import { formatAge, formatDuration, formatPercent } from "../lib/format.ts";

const GROUPS = [
  ["needs_you", "Needs you"],
  ["no_action", "No action"],
] as const;

export function InboxPage() {
  const { days } = useRange();
  const inbox = useInbox();
  const overview = useRpcQuery(["overview", days], (client) => client["history.overview"]({ days }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = inbox.data ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const stats = overview.data;
  const installs = useRunnerState();
  const slots = installs && installs.length > 0 ? listening(installs) : null;
  return (
    <div className="flex h-full flex-col">
      {stats && stats.repos.length > 0 ? (
        <Stats
          items={[
            [stats.jobs, "jobs"],
            [formatPercent(stats.failed, stats.jobs), "failed"],
            [stats.passedOnRetry, "passed on retry"],
            [stats.noRunner, "never got a runner"],
            [formatDuration(stats.p50Ms), "p50 passing job"],
            [formatDuration(stats.queueP50Ms), "queue p50"],
            ...(slots ? [[`${slots.online}/${slots.total}`, "slots listening"] as const] : []),
          ]}
        />
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          {stats && stats.repos.length === 0 ? (
            <NoHistory />
          ) : inbox.isSuccess && items.length === 0 ? (
            <p className="px-3 py-2 text-dim">Nothing needs you. No failures, waits or slow jobs in this range.</p>
          ) : (
            <table className="w-full border-collapse">
              {GROUPS.map(([group, heading]) => (
                <InboxGroup key={group} heading={heading} items={items.filter((item) => item.group === group)} selected={selected} onSelect={setSelectedId} />
              ))}
            </table>
          )}
        </div>
        {selected ? <InboxEvidence item={selected} /> : null}
        {selected ? (
          <ThreadDock
            key={selected.id}
            subject={{ _tag: "inbox", itemId: selected.id }}
            days={days}
            title={selected.title}
            detail={[selected.verdict, selected.repo ?? selected.install].filter(Boolean).join(", ")}
          />
        ) : null}
      </div>
    </div>
  );
}

function InboxGroup(props: { heading: string; items: InboxItem[]; selected: InboxItem | undefined; onSelect: (id: string) => void }) {
  if (props.items.length === 0) return null;
  return (
    <tbody>
      <tr>
        <th colSpan={5} className="px-3 pt-3 pb-1 text-left text-[11px] font-medium tracking-wide text-dim uppercase">
          {props.heading}
        </th>
      </tr>
      {props.items.map((item) => (
        <tr key={item.id} onClick={() => props.onSelect(item.id)} className={`cursor-default ${item.id === props.selected?.id ? "bg-surf2" : "hover:bg-surf"}`}>
          <td className="w-16 py-1 pr-3 pl-3"><InboxTag item={item} /></td>
          <td className="py-1 pr-3 whitespace-nowrap">{item.title}</td>
          <td className="py-1 pr-3 whitespace-nowrap text-dim">{item.repo ?? item.install}</td>
          <td className={`w-full py-1 pr-3 ${item.group === "no_action" ? "text-dim" : ""}`}>{item.detail}</td>
          <td className="py-1 pr-3 text-right whitespace-nowrap text-dim">{formatAge(item.at)}</td>
        </tr>
      ))}
    </tbody>
  );
}
