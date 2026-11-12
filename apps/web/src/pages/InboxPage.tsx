import { type InboxItem, inboxItems, type QuietGroup } from "@runnerbox/contracts";
import { useState } from "react";
import { InboxEvidence } from "../components/InboxEvidence.tsx";
import { NoHistory } from "../components/NoHistory.tsx";
import { ThreadDock } from "../components/ThreadDock.tsx";
import { useInbox } from "../hooks/useInbox.ts";
import { useRange } from "../hooks/useRange.ts";
import { formatAge } from "../lib/format.ts";

export function InboxPage() {
  const { days } = useRange();
  const inbox = useInbox();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const data = inbox.data;
  const all = data ? inboxItems(data) : [];
  const selected = all.find((item) => item.id === selectedId) ?? data?.items[0];
  const toggle = (kind: string) => setOpen((current) => new Set(current.has(kind) ? [...current].filter((each) => each !== kind) : [...current, kind]));
  if (data && data.summary.jobs === 0 && all.length === 0) return <NoHistory />;
  return (
    <div className="flex h-full flex-col">
      {data ? (
        <div className="px-3 pt-3 pb-2">
          <div className="text-[15px] font-medium">{data.summary.headline}</div>
          <div className="text-dim">{data.summary.facts.join(" ")}</div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            {data && data.items.length > 0 ? (
              <tbody>
                <Group heading="Needs you" />
                {data.items.map((item) => (
                  <Row key={item.id} item={item} selected={selected} onSelect={setSelectedId} />
                ))}
              </tbody>
            ) : null}
            {data && data.quiet.length > 0 ? (
              <tbody>
                <Group heading="Nothing to do" />
                {data.quiet.map((group) => (
                  <Quiet key={group.kind} group={group} open={open.has(group.kind)} onToggle={() => toggle(group.kind)} selected={selected} onSelect={setSelectedId} />
                ))}
              </tbody>
            ) : null}
          </table>
        </div>
        {selected ? <InboxEvidence item={selected} /> : null}
        {selected ? (
          <ThreadDock key={selected.id} subject={{ _tag: "inbox", itemId: selected.id }} days={days} title={selected.title} detail={selected.repo ?? selected.install ?? ""} />
        ) : null}
      </div>
    </div>
  );
}

const Group = ({ heading }: { heading: string }) => (
  <tr>
    <th colSpan={3} className="px-3 pt-3 pb-1 text-left text-[11px] font-medium tracking-wide text-dim uppercase">
      {heading}
    </th>
  </tr>
);

function Row(props: { item: InboxItem; selected: InboxItem | undefined; onSelect: (id: string) => void; indent?: boolean }) {
  const { item } = props;
  return (
    <tr onClick={() => props.onSelect(item.id)} className={`cursor-default align-top ${item.id === props.selected?.id ? "bg-surf2" : "hover:bg-surf"}`}>
      <td className={`py-1 pr-3 ${props.indent ? "pl-7" : "pl-3"}`}>
        <div>{item.title}</div>
        <div className="text-dim">{item.happened}</div>
      </td>
      <td className="py-1 pr-3 whitespace-nowrap text-dim">{item.repo ?? item.install}</td>
      <td className="py-1 pr-3 text-right whitespace-nowrap text-dim">{formatAge(item.at)}</td>
    </tr>
  );
}

// A quiet kind is one counted row until it's opened.
function Quiet(props: { group: QuietGroup; open: boolean; onToggle: () => void; selected: InboxItem | undefined; onSelect: (id: string) => void }) {
  return (
    <>
      <tr onClick={props.onToggle} className="cursor-default hover:bg-surf">
        <td colSpan={3} className="py-1 pr-3 pl-3">
          <span className="inline-block w-4 text-dim">{props.open ? "▾" : "▸"}</span>
          {props.group.title}
        </td>
      </tr>
      {props.open ? props.group.items.map((item) => <Row key={item.id} item={item} selected={props.selected} onSelect={props.onSelect} indent />) : null}
    </>
  );
}
