// A stand-in of runnerbox's, not T3 Code's file: what the copied toast reads from the composer's
// draft store, to scope a toast to a draft. Runnerbox keeps no drafts there, so there's never one.
import type { ScopedThreadRef } from "@t3tools/contracts";

type DraftStore = { getDraftSession: (draftId: string) => ScopedThreadRef | null };

const STORE: DraftStore = { getDraftSession: () => null };

export const useComposerDraftStore = <A>(select: (store: DraftStore) => A): A => select(STORE);
