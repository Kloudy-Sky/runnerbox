import type { Inbox, InboxItem } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery.ts";
import { failedJobId, pinned } from "../../lib/now.ts";
import type { RootSearch } from "../../lib/search.ts";

const keep = (previous: RootSearch) => previous;
const MAX_SHOWN = 5;

// What needs the owner, then jobs that failed in their own code in the last hour. The first is
// shown in full (two in a wide window) and the rest as one line each, so what's running stays in
// view. Each opens the same thread the home screen or the run's page would.
export function PinnedItems({ inbox, now }: { inbox: Inbox; now: number }) {
  const wide = useMediaQuery("md");
  const items = pinned(inbox, now);
  if (items.length === 0) return null;
  const full = wide ? 2 : 1;
  const shown = items.slice(0, MAX_SHOWN);
  return (
    <section className="flex flex-col gap-1.5 pb-2">
      {shown.map(({ item, kind }, index) => (
        <Pin key={item.id} item={item} kind={kind} full={index < full} />
      ))}
      {items.length > MAX_SHOWN ? (
        <Link to="/" search={keep} className="pl-4 text-muted-foreground hover:text-foreground hover:underline">
          {items.length - MAX_SHOWN} more need you
        </Link>
      ) : null}
    </section>
  );
}

function Pin({ item, kind, full }: { item: InboxItem; kind: "needs_you" | "code"; full: boolean }) {
  const jobId = kind === "code" ? failedJobId(item) : null;
  const target = (className: string, children: ReactNode) =>
    jobId !== null && item.repo ? (
      <Link to="/runs/$jobId" params={{ jobId: String(jobId) }} search={(previous: RootSearch) => ({ ...previous, repo: item.repo ?? undefined })} className={className}>
        {children}
      </Link>
    ) : (
      <Link to="/item/$itemId" params={{ itemId: item.id }} search={keep} className={className}>
        {children}
      </Link>
    );
  const marker = (
    <span className={`shrink-0 text-[10px] ${kind === "needs_you" ? "text-destructive" : "text-muted-foreground"}`}>{kind === "needs_you" ? "●" : "✗"}</span>
  );
  const title = `min-w-0 flex-1 font-medium ${kind === "needs_you" ? "text-destructive" : ""}`;
  if (!full) {
    return target("flex items-baseline gap-2 hover:underline", <>{marker}<span className={`truncate ${title}`}>{item.title}</span></>);
  }
  return (
    <div className="flex flex-col gap-0.5 pb-1">
      <div className="flex items-baseline gap-2">
        {marker}
        <span className={`line-clamp-2 ${title}`}>{item.title}</span>
      </div>
      <p className="line-clamp-2 pl-4 text-muted-foreground">
        {kind === "code" ? "the code · " : ""}
        {item.happened}
      </p>
      <div className="pl-4">{target("text-muted-foreground underline underline-offset-2 hover:text-foreground", "Look into it")}</div>
    </div>
  );
}
