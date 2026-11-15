// A stand-in of runnerbox's, not T3 Code's file: a quoted piece of an earlier answer. Runnerbox
// doesn't let the owner quote answers yet, so the composer never makes one; this only renders it.
import type { AssistantCitation } from "@t3tools/contracts";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";

export function AssistantCitationChip({ citation }: {
  citation: AssistantCitation;
  commentEditor?: {
    open: boolean;
    sourceAnchor?: AssistantCitationSourceAnchor | undefined;
    onOpenChange: (open: boolean) => void;
    onCancel?: () => void;
    onSave: (comment: string) => boolean;
    onSaveAndSend?: (comment: string) => boolean;
    onDraftChange?: (comment: string) => void;
    onRestoreFocus?: () => void;
  };
}) {
  return <span>{citation.text}</span>;
}
