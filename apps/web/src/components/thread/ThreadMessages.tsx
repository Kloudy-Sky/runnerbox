import type { ThreadItem } from "@runnerbox/contracts";
import { ChevronRight } from "lucide-react";
import type { ThreadView } from "../../lib/threadView.ts";
import { toolPhrase } from "../../lib/toolPhrases.ts";
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
          <div className="text-muted-foreground text-xs">You</div>
          <p className="whitespace-pre-wrap">{item.text}</p>
        </div>
      );
    case "AgentText":
      return <p className="enter whitespace-pre-wrap">{item.text}</p>;
    case "ToolCall":
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
    case "TurnEnded":
      return item.outcome === "interrupted" ? (
        <div className="-mt-2 font-mono text-[12px] text-faint">{item.message ?? "stopped"}</div>
      ) : item.outcome === "failed" ? (
        <p className="text-destructive">{item.message}</p>
      ) : null;
  }
}
