import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { InboxMachine } from "../../hooks/useInboxEverywhere.ts";
import type { InboxRows } from "../../lib/inboxRows.ts";
import { itemMeta, reviewMeta, STATUS_WORDS } from "../../lib/inboxWords.ts";
import type { RootSearch } from "../../lib/search.ts";
import { cn } from "../../lib/utils.ts";

const SHOWN = 3;
const keep = (previous: RootSearch) => previous;

function Row({ title, meta, status, link }: { title: string; meta: string; status: { label: string; tone: string }; link: ReactNode }) {
  return (
    <li className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-1 text-muted-foreground">
      <span className="truncate">
        <span className="font-semibold text-foreground">{title}</span>
        {meta ? ` · ${meta}` : null}
      </span>
      <span className={cn("text-xs leading-5", status.tone)}>{status.label}</span>
      {link}
    </li>
  );
}

// The Inbox's first rows, in its order: what needs the owner, most costly first, then their reviews
// that found something. Each row opens in the Inbox.
export function OverviewInbox({ rows, machines }: { rows: InboxRows; machines: ReadonlyArray<InboxMachine> }) {
  const labelOf = (environmentId: string) => machines.find((machine) => machine.environmentId === environmentId)?.label ?? "";
  const waiting = rows.needsYou.length + rows.reviews.length;
  const items = rows.needsYou.slice(0, SHOWN);
  const reviews = rows.reviews.slice(0, SHOWN - items.length);
  const cover = "absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <section>
      <div className="flex items-baseline justify-between pb-1.5">
        <h2 className="font-semibold">
          Inbox {waiting > 0 ? <span className="pl-1 font-normal text-muted-foreground tabular-nums">{waiting}</span> : null}
        </h2>
        <Link to="/inbox" search={keep} className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
          Open the inbox
        </Link>
      </div>
      {waiting === 0 ? <p className="py-1 text-muted-foreground">Nothing needs you.</p> : null}
      <ul>
        {items.map((row) => (
          <Row
            key={row.id}
            title={row.item.title}
            meta={itemMeta(row, labelOf(row.newestOn))}
            status={STATUS_WORDS[row.status]}
            link={<Link to="/inbox/$itemId" params={{ itemId: row.id }} search={keep} aria-label={row.item.title} className={cover} />}
          />
        ))}
        {reviews.map((row) => {
          const [owner = "", name = ""] = row.pull.repo.split("/");
          return (
            <Row
              key={row.id}
              title={`#${row.pull.number} ${row.pull.title}`}
              meta={reviewMeta(row)}
              status={STATUS_WORDS[row.status]}
              link={<Link to="/pulls/$owner/$name/$number" params={{ owner, name, number: String(row.pull.number) }} search={keep} aria-label={row.pull.title} className={cover} />}
            />
          );
        })}
      </ul>
    </section>
  );
}
