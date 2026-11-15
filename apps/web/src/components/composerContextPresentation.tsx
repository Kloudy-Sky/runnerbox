// A stand-in of runnerbox's, not T3 Code's file: how the copied composer shows context
// records (images, files, terminals, review comments) inline. Runnerbox's composer has none of
// those in its text, so a reference shows as its label.
import { createContext, use } from "react";
import { ContextChip } from "./ContextChip";

export { ComposerContextActionsContext, type ComposerContextActions } from "./composerContextActions";

export type ComposerDraftContextRecords = ReadonlyMap<string, never>;

export const EMPTY_COMPOSER_CONTEXT_RECORDS: ComposerDraftContextRecords = new Map<string, never>();

export const ComposerContextRecordsContext = createContext<ComposerDraftContextRecords>(EMPTY_COMPOSER_CONTEXT_RECORDS);

export function ComposerContextReferenceChip({ label }: { kind: string; contextId: string; label: string }) {
  use(ComposerContextRecordsContext);
  return <ContextChip contentEditable={false}>{label}</ContextChip>;
}
