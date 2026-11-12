import { useState } from "react";
import type { useThread } from "../../hooks/useThread.ts";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";

type Thread = ReturnType<typeof useThread>;

// The one composer at the bottom of the reading column. Stop takes Send's place while a turn
// runs. When the agent can't run here, it says why in one line instead.
export function Composer({ thread, placeholder }: { thread: Thread; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const { view } = thread;
  const unavailable = !thread.permitted
    ? "This session can't run the agent. Pair again by address or over SSH to use it."
    : thread.provider && !thread.provider.available
      ? `${thread.provider.provider} isn't available on this environment. ${thread.provider.fix ?? ""}`
      : null;
  if (unavailable) return <p className="text-muted-foreground">{unavailable}</p>;

  const submit = async () => {
    const text = draft.trim();
    if (text === "" || view.running) return;
    if (await thread.send(text)) setDraft("");
  };
  return (
    <div className="flex flex-col gap-1.5" data-slot="composer">
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={view.items.length === 0 ? placeholder : "Ask a follow-up"}
        className="[&_textarea]:min-h-11"
      />
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span className="flex-1">{thread.provider?.provider ?? "Agent"}, read-only</span>
        {view.items.length > 0 && !view.running ? (
          <Button variant="link" size="xs" onClick={thread.startFresh}>
            New thread
          </Button>
        ) : null}
        {view.running ? (
          <Button variant="secondary" size="sm" onClick={thread.interrupt}>
            Stop
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={draft.trim() === ""} onClick={() => void submit()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
