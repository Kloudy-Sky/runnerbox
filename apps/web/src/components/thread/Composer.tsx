import type { ServerProviderSkill } from "@t3tools/contracts";
import { PaperclipIcon } from "lucide-react";
import { useRef, useState } from "react";
import { collapseExpandedComposerCursor, composerSubmissionIntentForKey } from "../../composer-logic.ts";
import { useComposerDraftStore } from "../../composerDraftStore.ts";
import { useAccounts } from "../../hooks/useAccounts.ts";
import type { useComposerAttachments } from "../../hooks/useComposerAttachments.ts";
import { useHarnesses } from "../../hooks/useHarnesses.ts";
import { useRange } from "../../hooks/useRange.ts";
import { useReferenceCandidates } from "../../hooks/useReferenceCandidates.ts";
import type { useThread } from "../../hooks/useThread.ts";
import { type ReferenceCandidate, referenceToken, withReferences } from "../../lib/composerReferences.ts";
import { detectComposerTrigger, replaceTextRange } from "../../t3tools/shared/composerTrigger.ts";
import { type ComposerPromptEditorHandle, ComposerPromptEditorTiptap } from "../ComposerPromptEditorTiptap.tsx";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation.tsx";
import { Button } from "../ui/button.tsx";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip.tsx";
import { AttachmentStrip } from "./AttachmentStrip.tsx";
import { DeleteThread } from "./DeleteThread.tsx";
import { ModelMenu } from "./ModelMenu.tsx";
import { ReferenceMenu } from "./ReferenceMenu.tsx";
import { ReproduceControl } from "./ReproduceControl.tsx";

type Thread = ReturnType<typeof useThread>;
type Attachments = ReturnType<typeof useComposerAttachments>;

// What the file picker offers; anything else dropped or pasted is refused with a reason.
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,text/*,.log,.txt,.md,.json,.yaml,.yml,.csv,.xml,.toml";
const NO_SKILLS: ReadonlyArray<ServerProviderSkill> = [];
const MAX_MENU_ITEMS = 8;

// The one composer at the bottom of the reading column, laid out as T3 Code's: the files attached,
// the rich text editor whose Markdown is sent, and a row inside the box with attach, what the turn
// runs on, and Send or Stop. `@` refers to another thread or run. Under the box, what the agent
// may do and the thread's own actions. The draft is kept per subject, across navigation and
// restarts. When the agent can't run here, it says why in one line instead.
export function Composer({ thread, attachments, placeholder }: { thread: Thread; attachments: Attachments; placeholder: string }) {
  const picker = useRef<HTMLInputElement>(null);
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const draft = useComposerDraftStore((store) => store.drafts[thread.draftKey]?.value ?? "");
  const setDraft = useComposerDraftStore((store) => store.setDraft);
  const settleSent = useComposerDraftStore((store) => store.settleSent);
  const [cursor, setCursor] = useState(() => draft.length);
  const [expandedCursor, setExpandedCursor] = useState(() => draft.length);
  const { view } = thread;
  const { days } = useRange();
  const { accounts } = useAccounts();
  const harnesses = useHarnesses();

  // The account and model picked here, or what this thread last ran on if it still exists, or the
  // defaults. An account removed since falls through to the default, so the thread stays usable.
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const [pickedModel, setPickedModel] = useState<{ readonly model: string | null } | null>(null);
  const lastAsked = view.items.findLast((item) => item._tag === "UserMessage" && item.source === undefined);
  const remembered = lastAsked?._tag === "UserMessage" ? lastAsked : undefined;
  const accountId = pickedAccount ?? accounts.find((account) => account.id === remembered?.accountId)?.id ?? accounts.find((account) => account.isDefault)?.id;
  const account = accounts.find((candidate) => candidate.id === accountId);
  const model = pickedModel !== null ? pickedModel.model : (remembered?.model ?? null);

  // `@` opens the reference list until it's dismissed at that spot or the text moves on.
  const trigger = detectComposerTrigger(draft, expandedCursor);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const referring = trigger?.kind === "path" && dismissedAt !== trigger.rangeStart;
  const candidates = useReferenceCandidates(thread.environmentId, days, view.thread?.id ?? null, referring);
  const query = trigger?.query.toLowerCase() ?? "";
  const matches = referring ? candidates.items.filter((candidate) => candidate.label.toLowerCase().includes(query)).slice(0, MAX_MENU_ITEMS) : [];
  const [highlight, setHighlight] = useState(0);
  const active = Math.min(highlight, Math.max(0, matches.length - 1));

  const status = account?.status ?? thread.provider;
  const unavailable = !thread.permitted
    ? "This session can't run the agent. Pair again by address or over SSH to use it."
    : status && !status.available
      ? `${account?.label ?? status.provider} can't run here. ${status.fix ?? ""}`
      : null;
  if (unavailable) {
    return (
      <div className="flex flex-col gap-1 text-muted-foreground">
        <p>{unavailable}</p>
        {accounts.length > 1 ? (
          <div className="text-xs">
            <ModelMenu harnesses={harnesses} accounts={accounts} accountId={accountId} model={model} onAccount={setPickedAccount} onModel={(next) => setPickedModel({ model: next })} />
          </div>
        ) : null}
      </div>
    );
  }

  const pick = (candidate: ReferenceCandidate) => {
    if (trigger === null) return;
    const next = replaceTextRange(draft, trigger.rangeStart, trigger.rangeEnd, referenceToken(candidate));
    const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
    setDraft(thread.draftKey, next.text);
    setCursor(nextCursor);
    setExpandedCursor(next.cursor);
    setHighlight(0);
    // As T3 Code does: focus once the editor has the new text, and only if nothing changed it since.
    window.requestAnimationFrame(() => {
      if (useComposerDraftStore.getState().drafts[thread.draftKey]?.value === next.text) editorRef.current?.focusAt(nextCursor);
    });
  };

  // A question needs words; files wait until every one has finished uploading.
  const sending = withReferences(draft.trim());
  const canSend = sending.text !== "" && !attachments.busy && !sending.tooMany;
  const submit = async () => {
    if (!canSend || view.running) return;
    const sentIds = attachments.staged.map((file) => file.id);
    if (await thread.send(sending.text, { accountId, model: model ?? undefined, attachments: sentIds, references: sending.references })) {
      settleSent(thread.draftKey, sentIds);
      attachments.settle();
      setCursor(0);
      setExpandedCursor(0);
    }
  };

  // While the list is open it has the arrows, Enter, Tab and Escape; otherwise Enter sends and
  // Shift+Enter starts a new line, as T3 Code decides it, in a list too, where Shift+Enter adds the
  // next item. Inside a code block, Enter is the editor's own.
  const onCommandKey = (key: string, event: KeyboardEvent) => {
    if (referring && trigger !== null) {
      if (key === "Escape") {
        setDismissedAt(trigger.rangeStart);
        return true;
      }
      if ((key === "ArrowDown" || key === "ArrowUp") && matches.length > 0) {
        setHighlight((active + (key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return true;
      }
      // Enter and Tab pick while the list is open, and do nothing while it's still loading, so a
      // half-typed `@word` is never sent by the key meant to pick it.
      if ((key === "Enter" || key === "Tab") && !event.shiftKey) {
        const chosen = matches[active];
        if (chosen) pick(chosen);
        return true;
      }
    }
    const intent = composerSubmissionIntentForKey({ event, keybindings: [], isSoftwareKeyboardOpen: false, isDraftThread: false, isRunning: view.running, sendShortcut: "enter", prompt: draft });
    if (intent !== "foreground") return false;
    void submit();
    return true;
  };

  return (
    <div className="flex flex-col gap-1.5" data-slot="composer">
      <div className="relative rounded-2xl border border-input bg-background text-sm has-focus-visible:border-ring dark:bg-input/32">
        {referring ? <ReferenceMenu items={matches} active={active} loading={candidates.loading} failed={candidates.failed} onPick={pick} /> : null}
        <div className="px-3.5 pt-3">
          <AttachmentStrip staged={attachments.staged} uploading={attachments.uploading} onRemove={attachments.remove} />
          <ComposerPromptEditorTiptap
            draftKey={thread.draftKey}
            value={draft}
            cursor={cursor}
            richTextEnabled
            contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
            skills={NO_SKILLS}
            disabled={false}
            placeholder={view.items.length === 0 ? placeholder : "Ask a follow-up, or @ to refer to another thread or run"}
            ariaLabel="Message"
            className="max-h-64 min-h-11 overflow-y-auto"
            onChange={(next, nextCursor, nextExpanded) => {
              setDraft(thread.draftKey, next);
              setCursor(nextCursor);
              setExpandedCursor(nextExpanded);
            }}
            onCommandKeyDown={onCommandKey}
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
        <div className="flex min-w-0 flex-nowrap items-center px-2 pb-2" data-slot="composer-footer">
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" onPointerDown={(event) => event.preventDefault()} onClick={() => picker.current?.click()} aria-label="Attach files" />}>
              <PaperclipIcon className="translate-y-px" />
            </TooltipTrigger>
            <TooltipPopup>Attach images or text files</TooltipPopup>
          </Tooltip>
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
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <ModelMenu harnesses={harnesses} accounts={accounts} accountId={accountId} model={model} onAccount={setPickedAccount} onModel={(next) => setPickedModel({ model: next })} />
            {view.running ? (
              <button
                type="button"
                onClick={thread.interrupt}
                aria-label="Stop"
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 hover:bg-destructive"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                  <rect x="2" y="2" width="8" height="8" rx="1.5" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canSend}
                aria-label="Send"
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs shadow-message-action/24 hover:bg-message-action-hover disabled:pointer-events-none disabled:bg-foreground/12 disabled:text-muted-foreground disabled:shadow-none"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      {attachments.refusal !== null ? <p className="text-destructive text-xs">{attachments.refusal}</p> : null}
      {sending.tooMany ? <p className="text-destructive text-xs">A question can refer to up to 3 threads or runs.</p> : null}
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {/* Gives way first when the thread's actions need the room. */}
        <span className="min-w-0 flex-1 truncate">{thread.reproduce.running ? "The agent reads, runs commands in the container, and proposes changes for you." : "The agent reads and proposes changes for you."}</span>
        <ReproduceControl thread={thread} />
        {view.items.length > 0 && !view.running ? (
          <>
            <Button variant="link" size="xs" onClick={thread.startFresh}>
              New thread
            </Button>
            <DeleteThread thread={thread} />
          </>
        ) : null}
      </div>
    </div>
  );
}
