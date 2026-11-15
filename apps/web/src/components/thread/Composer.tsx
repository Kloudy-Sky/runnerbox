import type { ServerProviderSkill } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { composerSubmissionIntentForKey } from "../../composer-logic.ts";
import { useComposerDraftStore } from "../../composerDraftStore.ts";
import type { useComposerAttachments } from "../../hooks/useComposerAttachments.ts";
import type { useThread } from "../../hooks/useThread.ts";
import { useAccounts } from "../../hooks/useAccounts.ts";
import { Button } from "../ui/button.tsx";
import { PaperclipIcon } from "lucide-react";
import { AttachmentStrip } from "./AttachmentStrip.tsx";
import { DeleteThread } from "./DeleteThread.tsx";
import { ReproduceControl } from "./ReproduceControl.tsx";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { type ComposerPromptEditorHandle, ComposerPromptEditorTiptap } from "../ComposerPromptEditorTiptap.tsx";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation.tsx";

type Thread = ReturnType<typeof useThread>;
type Attachments = ReturnType<typeof useComposerAttachments>;

// What the file picker offers; anything else dropped or pasted is refused with a reason.
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,text/*,.log,.txt,.md,.json,.yaml,.yml,.csv,.xml,.toml";

const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];

// The one composer at the bottom of the reading column: T3 Code's rich text editor, whose Markdown
// is what's sent, with the files attached to it above. Its draft is kept per subject, across
// navigation and restarts. Stop takes Send's place while a turn runs. When the agent can't run
// here, it says why in one line instead.
export function Composer({ thread, attachments, placeholder }: { thread: Thread; attachments: Attachments; placeholder: string }) {
  const picker = useRef<HTMLInputElement>(null);
  const draft = useComposerDraftStore((store) => store.drafts[thread.draftKey]?.value ?? "");
  const setDraft = useComposerDraftStore((store) => store.setDraft);
  const settleSent = useComposerDraftStore((store) => store.settleSent);
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
  const accountPicker =
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
      <span className="shrink-0 whitespace-nowrap">{account?.label ?? thread.provider?.provider ?? "Agent"}</span>
    );
  if (unavailable) {
    return (
      <div className="flex flex-col gap-1 text-muted-foreground">
        <p>{unavailable}</p>
        {accounts.length > 1 ? <div className="text-xs">{accountPicker}</div> : null}
      </div>
    );
  }

  // A question needs words; files wait until every one has finished uploading.
  const canSend = draft.trim() !== "" && !attachments.busy;
  const submit = async () => {
    const text = draft.trim();
    if (!canSend || view.running) return;
    const sentIds = attachments.staged.map((file) => file.id);
    if (await thread.send(text, accountId, sentIds)) {
      settleSent(thread.draftKey, sentIds);
      attachments.settle();
      setCursor(0);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" data-slot="composer">
      <div className="rounded-lg border border-input bg-background px-3 py-2 text-sm has-focus-visible:border-ring dark:bg-input/32">
        <AttachmentStrip staged={attachments.staged} uploading={attachments.uploading} onRemove={attachments.remove} />
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
          // Files pasted are attached, not put in the text.
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            attachments.add(files);
          }}
          editorRef={editorRef}
        />
      </div>
      {attachments.refusal !== null ? <p className="text-destructive text-xs">{attachments.refusal}</p> : null}
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label="Attach files" title="Attach images or text files" onClick={() => picker.current?.click()}>
            <PaperclipIcon />
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(event) => {
              attachments.add([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          {accountPicker}
          {/* Gives way first when the footer's actions need the room. */}
          <span className="min-w-0 truncate">{thread.reproduce.running ? "reads, runs commands in the container, proposes changes for you" : "reads, proposes changes for you"}</span>
        </span>
        <ReproduceControl thread={thread} />
        {view.items.length > 0 && !view.running ? (
          <>
            <Button variant="link" size="xs" onClick={thread.startFresh}>
              New thread
            </Button>
            <DeleteThread thread={thread} />
          </>
        ) : null}
        {view.running ? (
          <Button variant="secondary" size="sm" onClick={thread.interrupt}>
            Stop
          </Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={!canSend} onClick={() => void submit()}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
