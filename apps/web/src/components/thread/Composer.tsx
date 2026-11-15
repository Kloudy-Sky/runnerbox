import type { ServerProviderSkill } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { composerSubmissionIntentForKey } from "../../composer-logic.ts";
import { useComposerDraftStore } from "../../composerDraftStore.ts";
import type { useThread } from "../../hooks/useThread.ts";
import { useAccounts } from "../../hooks/useAccounts.ts";
import { Button } from "../ui/button.tsx";
import { ReproduceControl } from "./ReproduceControl.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { type ComposerPromptEditorHandle, ComposerPromptEditorTiptap } from "../ComposerPromptEditorTiptap.tsx";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation.tsx";

type Thread = ReturnType<typeof useThread>;

const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];

// The one composer at the bottom of the reading column: T3 Code's rich text editor, whose Markdown
// is what's sent. Its draft is kept per subject, across navigation and restarts. Stop takes
// Send's place while a turn runs. When the agent can't run here, it says why in one line instead.
export function Composer({ thread, placeholder }: { thread: Thread; placeholder: string }) {
  const draft = useComposerDraftStore((store) => store.drafts[thread.draftKey]?.value ?? "");
  const setDraft = useComposerDraftStore((store) => store.setDraft);
  const clearDraft = useComposerDraftStore((store) => store.clearDraft);
  const [cursor, setCursor] = useState(() => draft.length);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
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
    if (await thread.send(text, accountId)) {
      clearDraft(thread.draftKey);
      setCursor(0);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" data-slot="composer">
      <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm has-focus-visible:border-ring dark:bg-input/32">
        <ComposerPromptEditorTiptap
          draftKey={thread.draftKey}
          value={draft}
          cursor={cursor}
          richTextEnabled
          contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
          skills={NO_SKILLS}
          disabled={false}
          placeholder={view.items.length === 0 ? placeholder : "Ask a follow-up"}
          ariaLabel="Message"
          className="max-h-64 min-h-11 overflow-y-auto"
          onChange={(next, nextCursor) => {
            setDraft(thread.draftKey, next);
            setCursor(nextCursor);
          }}
          // Enter sends and Shift+Enter starts a new line, as T3 Code decides it, in a list too, where
          // Shift+Enter adds the next item. Inside a code block, Enter is the editor's own.
          onCommandKeyDown={(_key, event) => {
            const intent = composerSubmissionIntentForKey({ event, keybindings: [], isSoftwareKeyboardOpen: false, isDraftThread: false, isRunning: view.running, sendShortcut: "enter", prompt: draft });
            if (intent !== "foreground") return false;
            void submit();
            return true;
          }}
          onPaste={() => {}}
          editorRef={editorRef}
        />
      </div>
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span className="flex flex-1 items-center gap-1">
          {picker}
          <span>{thread.reproduce.running ? "reads, runs commands in the container, proposes changes for you" : "reads, proposes changes for you"}</span>
        </span>
        <ReproduceControl thread={thread} />
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
