import { useEffect } from "react";
import { useProposals } from "../../hooks/useProposals.ts";
import type { ThreadView } from "../../lib/threadView.ts";
import { timelineRows } from "../../lib/threadTimeline.ts";
import { TimelineSystemDivider } from "../chat/TimelineSystemDivider.tsx";
import { ProposalBlock } from "../proposals/ProposalBlock.tsx";
import { AnswerRow } from "./AnswerRow.tsx";
import { QueuedQuestion } from "./QueuedQuestion.tsx";
import { QuestionRow } from "./QuestionRow.tsx";
import { TurnFoldRow } from "./TurnFoldRow.tsx";
import { WorkGroupRow } from "./WorkGroupRow.tsx";
import { WorkingRow } from "./WorkingRow.tsx";

// The thread under an item, laid out as T3 Code's timeline: each question in a bubble, the agent's
// words in full, its tool calls as plain lines while it works and folded under how long it took once
// it's done, then how the turn ended if it didn't finish, and the question waiting, if any.
export function ThreadMessages({ view, error, environmentId, onCancelQueued }: { view: ThreadView; error: string | null; environmentId: string; onCancelQueued: () => void }) {
  if (view.items.length === 0 && !view.partial && !error && !view.queued) return null;
  const rows = timelineRows(view.items);
  const lastAnswer = view.running ? undefined : rows.findLast((row) => row.kind === "answer");
  // A turn's last words carry its copy button and time; words before them in the turn don't.
  const finalWords = new Map(view.items.flatMap((item) => (item._tag === "AgentText" ? [[item.turnId, item.seq] as const] : [])));
  const asked = view.items.findLast((item) => item._tag === "UserMessage");
  const threadId = view.thread?.id ?? null;
  return (
    <div className="flex min-w-0 flex-col" data-slot="thread">
      {rows.map((row) => {
        switch (row.kind) {
          case "question":
            return <QuestionRow key={row.item.seq} item={row.item} environmentId={environmentId} threadId={threadId} />;
          case "answer":
            return <AnswerRow key={row.item.seq} text={row.item.text} at={finalWords.get(row.item.turnId) === row.item.seq ? row.item.at : null} last={row === lastAnswer} />;
          case "work":
            return <WorkGroupRow key={row.id} entries={row.entries} />;
          case "fold":
            return (
              <div key={row.id} className="pb-1.5">
                <TurnFoldRow label={row.label} entries={row.entries} />
              </div>
            );
          case "proposal":
            return (
              <div key={row.item.seq} className="min-w-0 px-1 py-0.5 pb-4">
                <ThreadProposal id={row.item.proposalId} />
              </div>
            );
          case "divider":
            return (
              <div key={row.id} className="pb-2">
                <TimelineSystemDivider label={row.label} detail={row.detail} tone={row.tone} wrapDetail />
              </div>
            );
        }
      })}
      {view.partial ? <AnswerRow text={view.partial.text} at={null} last={false} /> : null}
      {view.running && asked ? (
        <div className="pb-1.5">
          <WorkingRow since={asked.at} />
        </div>
      ) : null}
      {view.queued ? (
        <div className="pt-2 pb-4">
          <QueuedQuestion queued={view.queued} onCancel={onCancelQueued} />
        </div>
      ) : null}
      {error ? <p className="pb-2 text-destructive">{error}</p> : null}
    </div>
  );
}

// A proposal the agent made in this thread, as it stands now. Revert lives in Settings, Changes.
function ThreadProposal({ id }: { id: string }) {
  const actions = useProposals();
  const proposal = actions.proposals.find((candidate) => candidate.id === id);
  const { refresh } = actions;
  const missing = proposal === undefined;
  // A proposal made just now isn't in a list fetched before it, so that list is asked for again.
  useEffect(() => {
    if (missing) void refresh();
  }, [missing, id]);
  return proposal ? <ProposalBlock proposal={proposal} actions={actions} offerRevert={false} /> : null;
}
