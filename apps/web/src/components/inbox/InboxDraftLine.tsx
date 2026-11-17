import { subjectKey } from "@runnerbox/contracts";
import { draftKeyOf, useComposerDraftStore } from "../../composerDraftStore.ts";

// A question the owner started in an item's thread and didn't send, under its row, after T3 Code's
// sidebar draft block. It's kept per machine, so each machine that reports the item is looked in.
export function InboxDraftLine({ itemId, environmentIds }: { itemId: string; environmentIds: ReadonlyArray<string> }) {
  const key = subjectKey({ _tag: "inbox", itemId });
  const draft = useComposerDraftStore((store) => environmentIds.map((environmentId) => store.drafts[draftKeyOf(environmentId, key)]).find((each) => each !== undefined));
  if (!draft) return null;
  const firstLine = draft.value.trim().split("\n", 1)[0] ?? "";
  const files = draft.attachments.length;
  const preview = firstLine.length > 0 ? firstLine : `${files} ${files === 1 ? "file" : "files"}`;
  return <span className="truncate pt-0.5 text-muted-foreground text-xs">Draft · {preview}</span>;
}
