// A stand-in of runnerbox's, not T3 Code's file: how the copied composer shows context
// records (images, files, terminals, review comments) inline. Runnerbox's composer has none of
// those in its text; a reference to a thread or run shows as its icon and label.
import { FileTextIcon, PlayIcon } from "lucide-react";
import { createContext, use } from "react";
import { ContextChip } from "./ContextChip";

export { ComposerContextActionsContext, type ComposerContextActions } from "./composerContextActions";

export type ComposerDraftContextRecords = ReadonlyMap<string, never>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map<string, never>();

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(EMPTY_COMPOSER_CONTEXT_RECORDS);

// A thread or run a question refers to, with the icon its `@` list shows.
export function ComposerContextReferenceChip({ kind, label }: { kind: string; contextId: string; label: string }) {
  use(ComposerContextRecordsContext);
  const Icon = kind === "run" ? PlayIcon : FileTextIcon;
  return (
    <ContextChip contentEditable={false}>
      <Icon />
      {label}
    </ContextChip>
  );
}
