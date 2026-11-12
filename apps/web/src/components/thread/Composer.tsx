import { useState } from "react";
import type { useThread } from "../../hooks/useThread.ts";
import { useAccounts } from "../../hooks/useAccounts.ts";
import { Button } from "../ui/button.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { Textarea } from "../ui/textarea.tsx";

type Thread = ReturnType<typeof useThread>;

// The one composer at the bottom of the reading column. Stop takes Send's place while a turn
// runs. When the agent can't run here, it says why in one line instead.
export function Composer({ thread, placeholder }: { thread: Thread; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const { view } = thread;
  const { accounts } = useAccounts();
  // The account picked here, or the one this thread last ran as if it still exists, or the default.
  const [picked, setPicked] = useState<string | null>(null);
  const lastUsed = view.items.findLast((item) => item._tag === "UserMessage" && item.accountId !== undefined);
  const remembered = lastUsed?._tag === "UserMessage" ? lastUsed.accountId : undefined;
  // An account removed since the thread last ran falls through to the default, so the thread stays usable.
  const accountId = picked ?? accounts.find((account) => account.id === remembered)?.id ?? accounts.find((account) => account.isDefault)?.id;
  const account = accounts.find((candidate) => candidate.id === accountId);
  const status = account?.status ?? thread.provider;
  const unavailable = !thread.permitted
    ? "This session can't run the agent. Pair again by address or over SSH to use it."
    : status && !status.available
      ? `${account?.label ?? status.provider} can't run here. ${status.fix ?? ""}`
      : null;
  const picker =
    accounts.length > 1 ? (
      <Select value={accountId ?? null} onValueChange={(value) => value && setPicked(value)}>
        <SelectTrigger size="sm" className="-ml-2 text-muted-foreground" aria-label="Account">
          <SelectValue>{() => account?.label ?? "Account"}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          {accounts.map((each) => (
            <SelectItem key={each.id} value={each.id}>
              {each.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    ) : (
      <span>{account?.label ?? thread.provider?.provider ?? "Agent"}</span>
    );
  if (unavailable) {
    return (
      <div className="flex flex-col gap-1 text-muted-foreground">
        <p>{unavailable}</p>
        {accounts.length > 1 ? <div className="text-xs">{picker}</div> : null}
      </div>
    );
  }

  const submit = async () => {
    const text = draft.trim();
    if (text === "" || view.running) return;
    if (await thread.send(text, accountId)) setDraft("");
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
        <span className="flex flex-1 items-center gap-1">
          {picker}
          <span>read-only</span>
        </span>
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
