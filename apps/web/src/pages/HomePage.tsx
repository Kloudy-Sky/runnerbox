import { inboxItems } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { Empty } from "../components/ui/empty.tsx";
import { Button } from "../components/ui/button.tsx";
import { Reading } from "../components/Reading.tsx";
import { useInbox } from "../hooks/useInbox.ts";
import type { RootSearch } from "../lib/search.ts";

const keep = (previous: RootSearch) => previous;

// What the app opens on when nothing is selected: one sentence on whether anything needs the
// owner, each thing that does as a short paragraph with its next step, and the week in four facts.
export function HomePage() {
  const inbox = useInbox().data;
  // The inbox also reads launcher events and live runner state, so a machine with no job log can
  // still have something that needs the owner, such as a slot that keeps failing.
  if (inbox && inbox.summary.jobs === 0 && inboxItems(inbox).length === 0) {
    return (
      <Empty.Root className="mx-auto">
        <Empty.Title>No job history on this machine yet</Empty.Title>
        <Empty.Description>
          Run <code className="font-mono text-foreground">runnerbox report --repo owner/name</code> on the server's machine to sync one.
        </Empty.Description>
      </Empty.Root>
    );
  }
  if (!inbox) return null;
  const quiet = inbox.quiet.map((group) => group.title.charAt(0).toLowerCase() + group.title.slice(1));
  return (
    <Reading.Root className="gap-8">
      <Reading.Header>
        <Reading.Title className="text-2xl">{inbox.summary.headline}</Reading.Title>
        <Reading.Meta>{inbox.summary.facts.join(" ")}</Reading.Meta>
      </Reading.Header>
      {inbox.items.length > 0 ? (
        <div className="flex flex-col gap-6">
          {inbox.items.map((item, index) => (
            <section key={item.id} className="enter flex flex-col gap-1.5">
              <h2 className="font-medium">
                <Link to="/item/$itemId" params={{ itemId: item.id }} search={keep} className="hover:underline">
                  {item.title}
                </Link>
              </h2>
              <p className="text-foreground/90">{item.happened}</p>
              <p className="text-muted-foreground">{item.action}</p>
              <div>
                {/* The first is the screen's one primary action; the rest stay quiet. */}
                <Button size="sm" variant={index === 0 ? "default" : "link"} render={<Link to="/item/$itemId" params={{ itemId: item.id }} search={keep} />}>
                  Look into it
                </Button>
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {quiet.length > 0 ? <p className="text-muted-foreground">Nothing to do: {quiet.join(", ")}.</p> : null}
    </Reading.Root>
  );
}
