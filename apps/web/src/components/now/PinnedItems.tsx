import type { Inbox } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { failedJobId, pinned } from "../../lib/now.ts";
import type { RootSearch } from "../../lib/search.ts";
import { VERDICT_WORDS } from "../../lib/vocabulary.ts";
import { Button } from "../ui/button.tsx";

const keep = (previous: RootSearch) => previous;

// What needs the owner, then jobs that failed in their own code in the last hour, each with one
// next step. "Look into it" opens the same thread the home screen or the run's page would.
export function PinnedItems({ inbox, now }: { inbox: Inbox; now: number }) {
  const items = pinned(inbox, now);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 pb-2">
      {items.map(({ item, kind }, index) => {
        const jobId = kind === "code" ? failedJobId(item) : null;
        const look = jobId !== null && item.repo
          ? <Link to="/runs/$jobId" params={{ jobId: String(jobId) }} search={(previous: RootSearch) => ({ ...previous, repo: item.repo ?? undefined })} />
          : <Link to="/item/$itemId" params={{ itemId: item.id }} search={keep} />;
        const label = kind === "code" ? "the code" : item.verdict ? VERDICT_WORDS[item.verdict] : null;
        return (
          <div key={item.id} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className={`shrink-0 text-[10px] ${kind === "needs_you" ? "text-destructive" : "text-muted-foreground"}`}>{kind === "needs_you" ? "●" : "✗"}</span>
              <span className={`line-clamp-2 min-w-0 flex-1 font-medium ${kind === "needs_you" ? "text-destructive" : ""}`}>{item.title}</span>
            </div>
            <p className="line-clamp-2 pl-4 text-muted-foreground">
              {label ? `${label} · ` : ""}
              {item.happened}
            </p>
            <div className="pl-4">
              <Button size="xs" variant="link" className={`h-auto px-0 ${index === 0 ? "text-primary" : "text-foreground"}`} render={look}>
                Look into it
              </Button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
