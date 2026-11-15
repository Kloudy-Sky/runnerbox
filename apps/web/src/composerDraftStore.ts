// Runnerbox's own, not T3 Code's file of this name: the composer's unsent drafts, one per subject
// on each environment, kept in this client's local storage so they survive navigation and a
// restart. A draft is the editor's Markdown. Nothing here goes to a server until it's sent.
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Drafts left this long are dropped, so storage doesn't fill with abandoned questions.
const DRAFT_TTL_MS = 30 * 24 * 60 * 60_000;

const Draft = Schema.Struct({ value: Schema.String, at: Schema.Number });
type Draft = typeof Draft.Type;
// What's in local storage can be anything another version, or another tab, wrote there.
const decodeStored = Schema.decodeUnknownOption(Schema.Struct({ drafts: Schema.Record(Schema.String, Draft) }));

type DraftStore = {
  readonly drafts: Readonly<Record<string, Draft>>;
  readonly setDraft: (key: string, value: string) => void;
  readonly clearDraft: (key: string) => void;
  // What the copied toast asks to scope a toast to a draft's thread. Runnerbox's drafts belong to a
  // subject, not a T3 Code draft thread, so there's never one.
  readonly getDraftSession: (draftId: string) => ScopedThreadRef | null;
};

// The drafts worth keeping from what local storage held: none if it can't be read, and none older
// than a month.
export const keptDrafts = (persisted: unknown, now: number): Readonly<Record<string, Draft>> => {
  const stored = Option.match(decodeStored(persisted), { onNone: () => ({}), onSome: ({ drafts }) => drafts });
  return Object.fromEntries(Object.entries(stored).filter(([, draft]) => now - draft.at < DRAFT_TTL_MS));
};

// A draft's key: the environment and the subject it's about, so two machines' threads on the same
// subject keep separate drafts.
export const draftKeyOf = (environmentId: string, subjectKey: string) => `${environmentId}\u0000${subjectKey}`;

const withoutKey = (drafts: Readonly<Record<string, Draft>>, key: string) => Object.fromEntries(Object.entries(drafts).filter(([each]) => each !== key));

export const useComposerDraftStore = create<DraftStore>()(
  persist(
    (set) => ({
      drafts: {},
      // An empty draft is no draft.
      setDraft: (key, value) => set(({ drafts }) => ({ drafts: value.trim() === "" ? withoutKey(drafts, key) : { ...drafts, [key]: { value, at: Date.now() } } })),
      clearDraft: (key) => set(({ drafts }) => ({ drafts: withoutKey(drafts, key) })),
      getDraftSession: () => null,
    }),
    {
      name: "runnerbox.composerDrafts",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ drafts }) => ({ drafts }),
      // Old drafts go when the store loads.
      merge: (persisted, current) => ({ ...current, drafts: keptDrafts(persisted, Date.now()) }),
    },
  ),
);
