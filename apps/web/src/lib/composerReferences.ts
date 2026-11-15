import { MAX_REFERENCES, type ThreadReference } from "@runnerbox/contracts";
import type { ComposerContextId } from "@t3tools/contracts";
import { collectComposerContextReferences, formatComposerContextReference, replaceComposerContextReferences } from "../t3tools/shared/composerContextReferences.ts";

// Something on this server a question can refer to with `@`: another thread, or a run.
export type ReferenceCandidate =
  | { readonly kind: "thread"; readonly id: string; readonly label: string; readonly detail: string }
  | { readonly kind: "run"; readonly repo: string; readonly jobId: number; readonly days: number; readonly label: string; readonly detail: string };

// A reference lives in the draft as T3 Code's context link, which the copied editor shows as a chip.
// Its ID must be letters, digits, `-` and `_`, so a run's repo, job and the window it was listed in
// travel as base64url, and the server finds it again whatever range the app shows by the time it's sent.
const base64url = (text: string) => btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromBase64url = (text: string) => atob(text.replaceAll("-", "+").replaceAll("_", "/"));
const RUN_ID = /^([^#]+)#(\d+)#(\d+)$/;

const contextIdOf = (candidate: ReferenceCandidate) => (candidate.kind === "thread" ? candidate.id : base64url(`${candidate.repo}#${candidate.jobId}#${candidate.days}`));

// What replaces `@query` in the editor when a candidate is picked.
export const referenceToken = (candidate: ReferenceCandidate) =>
  `${formatComposerContextReference({ kind: candidate.kind, contextId: contextIdOf(candidate) as ComposerContextId, label: candidate.label })} `;

const referenceOf = (kind: string, contextId: string): ThreadReference | null => {
  if (kind === "thread") return /^[0-9a-f]{16}$/.test(contextId) ? { _tag: "thread", id: contextId } : null;
  if (kind !== "run") return null;
  try {
    const match = RUN_ID.exec(fromBase64url(contextId));
    return match ? { _tag: "run", repo: match[1]!, jobId: Number(match[2]), days: Number(match[3]) } : null;
  } catch {
    return null;
  }
};

// A draft as it's sent: each reference becomes `@label` in the text, and the threads and runs go
// beside it, once each. More than the server takes is said before sending.
export function withReferences(markdown: string) {
  const references = new Map<string, ThreadReference>();
  for (const occurrence of collectComposerContextReferences(markdown)) {
    const reference = referenceOf(occurrence.kind, occurrence.contextId);
    if (reference) references.set(`${occurrence.kind}:${occurrence.contextId}`, reference);
  }
  const text = replaceComposerContextReferences(markdown, (occurrence) => `@${occurrence.label}`);
  return { text, references: [...references.values()], tooMany: references.size > MAX_REFERENCES };
}
