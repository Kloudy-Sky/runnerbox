import { Link, useParams } from "@tanstack/react-router";
import { CustomSnoozeDialogHost } from "../components/inbox/CustomSnoozeDialog.tsx";
import { InboxItemView } from "../components/inbox/InboxItemView.tsx";
import { InboxList } from "../components/inbox/InboxList.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty.tsx";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { useInboxEverywhere } from "../hooks/useInboxEverywhere.ts";
import { useInboxWrites } from "../hooks/useInboxWrites.ts";
import { findRow } from "../lib/inboxRows.ts";
import type { RootSearch } from "../lib/search.ts";
import { cn } from "../lib/utils.ts";

const keep = (previous: RootSearch) => previous;

// The Inbox tab, across every connected machine: the list on the left and the chosen item in full
// on the right. With none chosen, the costliest is shown. Narrow, it's one or the other, the list
// until an item is opened.
export function InboxPage() {
  const { itemId } = useParams({ strict: false });
  const { machines, rows, loaded } = useInboxEverywhere();
  const writes = useInboxWrites(machines);
  const activeId = useActiveEnvironment().environment?.environmentId;
  if (!loaded) return null;
  // The inbox also reads launcher events and live runner state, so a machine with no job log can
  // still have something that needs the owner, such as a slot that keeps failing.
  const empty = machines.every((machine) => !machine.inbox || (machine.inbox.summary.jobs === 0 && machine.inbox.items.length === 0 && machine.inbox.quiet.length === 0));
  if (empty && rows.reviews.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No job history yet</EmptyTitle>
          <EmptyDescription>
            Run <code className="font-mono text-foreground">runnerbox report --repo owner/name</code> on a server's machine to sync one.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const shownId = itemId ?? rows.needsYou[0]?.id;
  const shown = shownId === undefined ? undefined : findRow(rows.all, shownId, activeId);
  return (
    <div className="flex min-h-0 flex-1">
      <div className={cn("min-h-0 w-full shrink-0 overflow-y-auto md:block md:w-72 lg:w-80", itemId ? "hidden" : "block")}>
        <InboxList rows={rows} machines={machines} selectedId={shown?.id} />
      </div>
      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", itemId ? "flex" : "hidden md:flex")}>
        {itemId ? (
          <Link to="/inbox" search={keep} className="px-6 pt-3 text-muted-foreground text-xs hover:text-foreground md:hidden">
            Inbox
          </Link>
        ) : null}
        {shown ? (
          <InboxItemView row={shown} machines={machines} writes={writes} />
        ) : itemId ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>This item isn't in the inbox any more</EmptyTitle>
              <EmptyDescription>It may have been fixed, or fallen outside the time range.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </div>
      <CustomSnoozeDialogHost />
    </div>
  );
}
