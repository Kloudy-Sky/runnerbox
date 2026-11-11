import type { ThreadItem, ThreadSubject } from "@runnerbox/contracts";
import { useEffect, useRef, useState } from "react";
import { useThread } from "../hooks/useThread.ts";

// An agent thread on one inbox item or run, beside its evidence: the subject, the thread, and a
// composer. The agent runs on the environment's own Claude login and can only read.
export function ThreadDock(props: { subject: ThreadSubject; days: number; title: string; detail: string }) {
  const thread = useThread(props.subject, props.days);
  const { view } = thread;
  const scroller = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  // Keeps the newest text in view as it streams.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [view.items.length, view.partial?.text]);

  const submit = async () => {
    const text = draft.trim();
    if (text === "" || view.running) return;
    if (await thread.send(text)) setDraft("");
  };
  const unavailable = !thread.permitted
    ? "This session can't run threads. Pair again by address or over SSH to get them."
    : thread.provider && !thread.provider.available
      ? `${thread.provider.provider} isn't available on this environment. ${thread.provider.fix ?? ""}`
      : null;

  return (
    <aside className="ml-px flex w-[360px] shrink-0 flex-col bg-surf">
      <div className="flex items-baseline gap-2 px-3 pt-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{props.title}</div>
          <div className="truncate text-dim">{props.detail}</div>
        </div>
        {view.items.length > 0 && !view.running ? (
          <button type="button" className="text-dim hover:text-fg" onClick={thread.startFresh}>
            New thread
          </button>
        ) : null}
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {unavailable ? <p className="text-dim">{unavailable}</p> : null}
        {view.items.map((item) => (
          <Item key={item.seq} item={item} />
        ))}
        {view.partial ? <p className="mt-2 whitespace-pre-wrap">{view.partial.text}</p> : null}
        {thread.error ? <p className="mt-2 text-red">{thread.error}</p> : null}
      </div>
      {unavailable ? null : (
        <div className="px-3 pb-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder={view.items.length === 0 ? "Ask about this. Is the verdict right?" : "Ask a follow-up"}
            className="block w-full resize-none bg-surf2 px-2 py-1 text-fg outline-none placeholder:text-faint"
          />
          <div className="flex items-baseline pt-1 text-dim">
            <span className="flex-1">{thread.provider?.provider ?? ""}, read-only</span>
            {view.running ? (
              <button type="button" className="text-fg hover:text-red" onClick={thread.interrupt}>
                Stop
              </button>
            ) : (
              <button type="button" className="text-fg disabled:text-faint" disabled={draft.trim() === ""} onClick={() => void submit()}>
                Send
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function Item({ item }: { item: ThreadItem }) {
  switch (item._tag) {
    case "UserMessage":
      return <p className="mt-2 whitespace-pre-wrap text-dim">{item.text}</p>;
    case "AgentText":
      return <p className="mt-2 whitespace-pre-wrap">{item.text}</p>;
    case "ToolCall":
      return (
        <div className="truncate font-mono text-[11.5px] text-faint" title={item.input}>
          {item.name} {item.input === "{}" ? "" : item.input}
        </div>
      );
    case "TurnEnded":
      return item.outcome === "interrupted" ? (
        <div className="font-mono text-[11.5px] text-faint">{item.message ?? "stopped"}</div>
      ) : item.outcome === "failed" ? (
        <p className="mt-1 text-red">{item.message}</p>
      ) : null;
  }
}
