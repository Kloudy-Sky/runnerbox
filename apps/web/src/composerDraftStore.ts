// A stand-in of runnerbox's, not T3 Code's file of this name: the composer's unsent drafts, one per subject
// on each environment, kept in this client's local storage so they survive navigation and a
// restart. A draft is the editor's Markdown and the files staged for it: the server holds a staged
// file's bytes, and the draft only its ID and name.
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// Drafts left this long are dropped, so storage doesn't fill with abandoned questions.
const DRAFT_TTL_MS = 30 * 24 * 60 * 60_000;
// The server removes a staged file after a day; a draft forgets it a little sooner.
const STAGED_TTL_MS = 23 * 60 * 60_000;

const StagedFile = Schema.Struct({ id: Schema.String, name: Schema.String, size: Schema.Number, kind: Schema.Literals(["image", "text"]), at: Schema.Number });
export type StagedFile = typeof StagedFile.Type;
const Draft = Schema.Struct({ value: Schema.String, attachments: Schema.Array(StagedFile), at: Schema.Number });
type Draft = typeof Draft.Type;
// What's stored: drafts saved before attachments have none.
const StoredDraft = Schema.Struct({ value: Schema.String, attachments: Schema.optionalKey(Schema.Array(StagedFile)), at: Schema.Number });
const EMPTY: Draft = { value: "", attachments: [], at: 0 };
// A question this window sent to wait in a thread, as it was in the composer: the Markdown with its
// chips, its staged files, the text the server holds, and the thread's last item when it was
// queued. Kept, across a reload too, so that if it isn't sent the composer gets back exactly what was
// there. Only the window that queued it holds it.
const QueuedDraft = Schema.Struct({ markdown: Schema.String, files: Schema.Array(StagedFile), sentText: Schema.String, afterSeq: Schema.Number, at: Schema.Number });
export type QueuedDraft = typeof QueuedDraft.Type;
// What's in local storage can be anything another version, or another tab, wrote there.
const decodeStored = Schema.decodeUnknownOption(Schema.Struct({ drafts: Schema.Record(Schema.String, StoredDraft) }));
const decodeWaiting = Schema.decodeUnknownOption(Schema.Struct({ waiting: Schema.Record(Schema.String, QueuedDraft) }));

type DraftStore = {
  readonly drafts: Readonly<Record<string, Draft>>;
  readonly waiting: Readonly<Record<string, QueuedDraft>>;
  readonly rememberWaiting: (key: string, draft: QueuedDraft) => void;
  readonly forgetWaiting: (key: string) => void;
  readonly setDraft: (key: string, value: string) => void;
  readonly addAttachment: (key: string, file: StagedFile) => void;
  readonly removeAttachment: (key: string, id: string) => void;
  // After a send: its text and the files it took go, and a file attached meanwhile stays.
  readonly settleSent: (key: string, sentIds: ReadonlyArray<string>) => void;
  // A question that waited and wasn't sent comes back ahead of whatever is in the draft now.
  readonly restore: (key: string, markdown: string, files: ReadonlyArray<StagedFile>) => void;
  // What the copied toast asks to scope a toast to a draft's thread. Runnerbox's drafts belong to a
  // subject, not a T3 Code draft thread, so there's never one.
  readonly getDraftSession: (draftId: string) => ScopedThreadRef | null;
};

// The drafts worth keeping from what local storage held: none if it can't be read, none older than a
// month, and no staged file the server has already removed.
export const keptDrafts = (persisted: unknown, now: number): Readonly<Record<string, Draft>> => {
  const stored = Option.match(decodeStored(persisted), { onNone: () => ({}), onSome: ({ drafts }) => drafts });
  return Object.fromEntries(
    Object.entries(stored)
      .filter(([, draft]) => now - draft.at < DRAFT_TTL_MS)
      .map(([key, draft]) => [key, { ...draft, attachments: (draft.attachments ?? []).filter((file) => now - file.at < STAGED_TTL_MS) }]),
  );
};

// The waiting questions worth keeping: none the server can no longer have, a day on.
export const keptWaiting = (persisted: unknown, now: number): Readonly<Record<string, QueuedDraft>> => {
  const stored = Option.match(decodeWaiting(persisted), { onNone: () => ({}), onSome: ({ waiting }) => waiting });
  return Object.fromEntries(Object.entries(stored).filter(([, draft]) => now - draft.at < STAGED_TTL_MS));
};

// A draft's key: the environment and the subject it's about, so two machines' threads on the same
// subject keep separate drafts.
export const draftKeyOf = (environmentId: string, subjectKey: string) => `${environmentId}\u0000${subjectKey}`;

const withoutKey = (drafts: Readonly<Record<string, Draft>>, key: string) => Object.fromEntries(Object.entries(drafts).filter(([each]) => each !== key));
// An empty draft, no text and no files, is no draft.
const withDraft = (drafts: Readonly<Record<string, Draft>>, key: string, change: (draft: Draft) => Draft) => {
  const next = { ...change(drafts[key] ?? EMPTY), at: Date.now() };
  return next.value.trim() === "" && next.attachments.length === 0 ? withoutKey(drafts, key) : { ...drafts, [key]: next };
};

export const useComposerDraftStore = create<DraftStore>()(
  persist(
    (set) => ({
      drafts: {},
      waiting: {},
      rememberWaiting: (key, draft) => set(({ waiting }) => ({ waiting: { ...waiting, [key]: draft } })),
      forgetWaiting: (key) => set(({ waiting }) => ({ waiting: Object.fromEntries(Object.entries(waiting).filter(([each]) => each !== key)) })),
      setDraft: (key, value) => set(({ drafts }) => ({ drafts: withDraft(drafts, key, (draft) => ({ ...draft, value })) })),
      addAttachment: (key, file) => set(({ drafts }) => ({ drafts: withDraft(drafts, key, (draft) => ({ ...draft, attachments: [...draft.attachments, file] })) })),
      settleSent: (key, sentIds) =>
        set(({ drafts }) => ({ drafts: withDraft(drafts, key, (draft) => ({ ...draft, value: "", attachments: draft.attachments.filter((file) => !sentIds.includes(file.id)) })) })),
      restore: (key, markdown, files) =>
        set(({ drafts }) => ({
          drafts: withDraft(drafts, key, (draft) => ({
            ...draft,
            value: draft.value.trim() === "" ? markdown : `${markdown}\n\n${draft.value}`,
            attachments: [...files.filter((file) => !draft.attachments.some((each) => each.id === file.id)), ...draft.attachments],
          })),
        })),
      removeAttachment: (key, id) => set(({ drafts }) => ({ drafts: withDraft(drafts, key, (draft) => ({ ...draft, attachments: draft.attachments.filter((file) => file.id !== id) })) })),
      getDraftSession: () => null,
    }),
    {
      name: "runnerbox.composerDrafts",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ drafts, waiting }) => ({ drafts, waiting }),
      // Old drafts go when the store loads.
      merge: (persisted, current) => ({ ...current, drafts: keptDrafts(persisted, Date.now()), waiting: keptWaiting(persisted, Date.now()) }),
    },
  ),
);
