import { inboxItems } from "@runnerbox/contracts";
import { useParams } from "@tanstack/react-router";

import { useEffect, useState } from "react";
import { ItemEvidence } from "../components/ItemEvidence.tsx";
import { Reading } from "../components/Reading.tsx";
import { ThreadColumn } from "../components/ThreadColumn.tsx";
import { Button } from "../components/ui/button.tsx";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../components/ui/collapsible.tsx";
import { Empty } from "../components/ui/empty.tsx";
import { useInbox } from "../hooks/useInbox.ts";
import { useMonitors } from "../hooks/useMonitors.ts";
import { formatAge } from "../lib/format.ts";

const FIRST_QUESTION = "Is this right, and what should I do about it?";

// One inbox item as a short report: what happened, why, what you can do, then the agent.
export function ItemPage() {
  const { itemId } = useParams({ strict: false });
  const inbox = useInbox();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const item = inbox.data ? inboxItems(inbox.data).find((candidate) => candidate.id === itemId) : undefined;
  const monitors = useMonitors();
  const unread = itemId !== undefined && (monitors.status?.unread.includes(itemId) ?? false);
  const { markRead } = monitors;
  // Opening an item a monitor looked into reads what it left, so the sidebar's mark goes.
  useEffect(() => {
    if (unread && itemId) void markRead(itemId);
  }, [unread, itemId]);
  if (!item) {
    return inbox.data ? (
      <Empty.Root className="mx-auto">
        <Empty.Title>This item isn't in the inbox any more</Empty.Title>
        <Empty.Description>It may have been fixed, or fallen outside the time range.</Empty.Description>
      </Empty.Root>
    ) : null;
  }
  const evidenceCount = item.evidence.attempts.length;
  return (
    <ThreadColumn key={item.id} subject={{ _tag: "inbox", itemId: item.id }} placeholder="Ask about this">
      {(thread) => (
        <Reading.Root>
          <Reading.Header>
            <Reading.Title>{item.title}</Reading.Title>
            <Reading.Meta>{[item.repo ?? item.install, `${formatAge(item.at)} ago`].filter(Boolean).join(", ")}</Reading.Meta>
          </Reading.Header>
          <Reading.Section heading="What happened">{item.happened}</Reading.Section>
          <Reading.Section heading="Why">{item.why}</Reading.Section>
          <Reading.Section heading="What you can do">{item.action}</Reading.Section>
          <Reading.Actions>
            {thread.view.items.length === 0 && thread.permitted && thread.provider?.available ? (
              <Button onClick={() => void thread.send(FIRST_QUESTION)}>Ask the agent to investigate</Button>
            ) : null}
            <Button variant="ghost-muted" size="sm" onClick={() => setEvidenceOpen(!evidenceOpen)}>
              {evidenceOpen ? "Hide the evidence" : evidenceCount > 0 ? `Show the ${evidenceCount} ${evidenceCount === 1 ? "job" : "jobs"}` : "Show the evidence"}
            </Button>
          </Reading.Actions>
          <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
            <CollapsibleTrigger className="sr-only">Evidence</CollapsibleTrigger>
            <CollapsiblePanel>
              <ItemEvidence item={item} />
            </CollapsiblePanel>
          </Collapsible>
        </Reading.Root>
      )}
    </ThreadColumn>
  );
}

