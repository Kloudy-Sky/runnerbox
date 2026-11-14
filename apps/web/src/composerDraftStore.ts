// What T3 Code's copied toast reads from its composer's draft store, to scope a toast to a draft.
// Runnerbox keeps no drafts there, so there's never a session.
import type { ScopedThreadRef } from "@t3tools/contracts";

type DraftStore = { getDraftSession: (draftId: string) => ScopedThreadRef | null };

const STORE: DraftStore = { getDraftSession: () => null };

export const useComposerDraftStore = <A>(select: (store: DraftStore) => A): A => select(STORE);
