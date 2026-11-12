import type { ThreadItem } from "@runnerbox/contracts";
import type { ThreadView } from "../../lib/threadView.ts";

// The thread under an item: the owner's questions, the agent's answers, and each tool call as one
// quiet monospace line. Text that's still streaming fades in once and then sits still: no cursor.
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
        <div className="enter -my-2 truncate font-mono text-[12px] text-faint" title={item.input}>
          {item.name} {item.input === "{}" ? "" : item.input}
        </div>
      );
    case "TurnEnded":
      return item.outcome === "interrupted" ? (
        <div className="-mt-2 font-mono text-[12px] text-faint">{item.message ?? "stopped"}</div>
      ) : item.outcome === "failed" ? (
        <p className="text-destructive">{item.message}</p>
      ) : null;
  }
}
