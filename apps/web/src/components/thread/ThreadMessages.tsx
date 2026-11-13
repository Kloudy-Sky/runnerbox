import { useEffect } from "react";
import type { ThreadItem } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import type { ThreadView } from "../../lib/threadView.ts";
import { toolPhrase } from "../../lib/toolPhrases.ts";
import { useProposals } from "../../hooks/useProposals.ts";
import { ProposalBlock } from "../proposals/ProposalBlock.tsx";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible.tsx";

// The thread under an item: the owner's questions, the agent's answers, and each tool call as one
// quiet line saying what it read, with the raw call behind it. Text that's still streaming fades in once and then sits still: no cursor.
export function ThreadMessages({ view, error }: { view: ThreadView; error: string | null }) {
  if (view.items.length === 0 && !view.partial && !error) return null;
  return (
    <div className="flex flex-col gap-3" data-slot="thread">
      {view.items.map((item) => (
        <Item key={item.seq} item={item} />
      ))}
      {view.partial ? <p className="enter whitespace-pre-wrap">{view.partial.text}</p> : null}
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}

function Item({ item }: { item: ThreadItem }) {
  switch (item._tag) {
    case "UserMessage":
      return (
        <div className="enter">
          <div className="text-muted-foreground text-xs">{item.source === "monitor" ? "Monitor" : "You"}</div>
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
      );
    case "AgentText":
      return <p className="enter whitespace-pre-wrap">{item.text}</p>;
    case "ToolCall":
      // Its command and result are the ReproduceCommand line that follows, and a proposal's the
      // block that follows.
      if (item.name === "repro_exec" || item.name === "propose_change") return null;
      return (
        <Collapsible className="enter -my-1.5 text-[13px]">
          <CollapsibleTrigger className="group/tool flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5 transition-transform duration-150 group-data-panel-open/tool:rotate-90" />
            {toolPhrase(item.name)}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-1 pl-4.5 font-mono text-[12px] text-faint break-all">
              {item.name} {item.input === "{}" ? "" : item.input}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      );
    case "ReproduceStarted":
      return (
        <p className="enter text-[13px] text-muted-foreground">
          Container started on {item.kind}'s {item.imageFallback ? "current image" : "image the job ran on"}, {item.image}, with commit {item.commit.slice(0, 7)}
          {item.network === "setup" ? ". Its network goes after the first command." : "."}
        </p>
      );
    case "ReproduceCommand":
      return (
        <Collapsible className="enter -my-1.5 text-[13px]">
          <CollapsibleTrigger className="group/tool flex max-w-full items-center gap-1 text-left text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5 shrink-0 transition-transform duration-150 group-data-panel-open/tool:rotate-90" />
            <span className="truncate font-mono text-[12px] text-foreground">$ {item.command}</span>
            <span className={item.timedOut || item.exitCode !== 0 ? "shrink-0 text-destructive" : "shrink-0"}>
              {item.timedOut ? "timed out" : `exit ${item.exitCode ?? "?"}`}
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all pt-1 pl-4.5 font-mono text-[12px] text-faint">
              {item.truncated ? "(earlier output cut)\n" : ""}
              {item.output === "" ? "(no output)" : item.output}
            </pre>
          </CollapsiblePanel>
        </Collapsible>
      );
    case "ChangeProposed":
      return <ThreadProposal id={item.proposalId} />;
    case "ReproduceEnded":
      return <p className="enter text-[13px] text-muted-foreground">Container removed. {item.reason}</p>;
    case "TurnEnded":
      return item.outcome === "interrupted" ? (
        <div className="-mt-2 font-mono text-[12px] text-faint">{item.message ?? "stopped"}</div>
      ) : item.outcome === "failed" ? (
        <p className="text-destructive">{item.message}</p>
      ) : null;
  }
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
