import { Link } from "@tanstack/react-router";
import { useNow } from "../../hooks/useNow.ts";
import type { InboxMachine } from "../../hooks/useInboxEverywhere.ts";
import type { InboxRows, ItemRow, ReviewRow } from "../../lib/inboxRows.ts";
import { itemMeta, lowerFirst, reviewMeta, STATUS_WORDS } from "../../lib/inboxWords.ts";
import type { RootSearch } from "../../lib/search.ts";
import { snoozeWakeLabel } from "../../lib/snoozePresets.ts";
import { InboxDraftLine } from "./InboxDraftLine.tsx";
import { InboxRow } from "./InboxRow.tsx";
import { InboxShelf } from "./InboxShelf.tsx";

const keep = (previous: RootSearch) => previous;

// The Inbox's list: what needs the owner, most costly first, then their reviews that found
// something, then the working, snoozed and settled shelves, and what was handled without them.
export function InboxList({ rows, machines, selectedId }: { rows: InboxRows; machines: ReadonlyArray<InboxMachine>; selectedId: string | undefined }) {
  const now = useNow(60_000);
  const labelOf = (environmentId: string) => machines.find((machine) => machine.environmentId === environmentId)?.label ?? "";
  const item = (row: ItemRow, status = STATUS_WORDS[row.status]) => (
    <InboxRow
      key={row.id}
      status={status}
      title={row.item.title}
      meta={itemMeta(row, labelOf(row.newestOn))}
      active={row.id === selectedId}
      dim={row.status === "looking"}
      render={<Link to="/inbox/$itemId" params={{ itemId: row.id }} search={keep} />}
    >
      <InboxDraftLine itemId={row.item.id} environmentIds={row.copies.map((copy) => copy.environmentId)} />
    </InboxRow>
  );
  const review = (row: ReviewRow) => {
    const [owner = "", name = ""] = row.pull.repo.split("/");
    return (
      <InboxRow
        key={row.id}
        status={STATUS_WORDS[row.status]}
        title={`#${row.pull.number} ${row.pull.title}`}
        meta={reviewMeta(row)}
        active={false}
        dim={row.status === "reviewing"}
        render={<Link to="/reviews/$owner/$name/$number" params={{ owner, name, number: String(row.pull.number) }} search={keep} />}
      />
    );
  };
  const snoozed = (row: ItemRow) => {
    const until = row.item.state?.snoozedUntil;
    return item(row, { ...STATUS_WORDS.snoozed, label: until ? `Snoozed · ${snoozeWakeLabel(until, { now: new Date(now).toISOString() })}` : "Snoozed" });
  };
  const waiting = rows.needsYou.length + rows.reviews.length;
  return (
    <nav aria-label="Inbox" className="flex flex-col gap-3 px-2 py-3">
      {waiting > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {rows.needsYou.map((row) => item(row))}
          {rows.reviews.map(review)}
        </ul>
      ) : (
        <p className="px-2.5 py-2 text-muted-foreground">Nothing needs you.</p>
      )}
      <div className="flex flex-col">
        <InboxShelf label="Working" count={rows.working.items.length + rows.working.reviews.length}>
          {rows.working.items.map((row) => item(row))}
          {rows.working.reviews.map(review)}
        </InboxShelf>
        <InboxShelf label="Snoozed" count={rows.snoozed.length}>
          {rows.snoozed.map(snoozed)}
        </InboxShelf>
        <InboxShelf label="Settled" count={rows.settled.length}>
          {rows.settled.map((row) => item(row))}
        </InboxShelf>
      </div>
      {rows.handled.length > 0 ? (
        <p className="px-2.5 text-muted-foreground text-xs">
          Handled without you: {rows.handled.map(lowerFirst).join(", ")}.
        </p>
      ) : null}
    </nav>
  );
}
