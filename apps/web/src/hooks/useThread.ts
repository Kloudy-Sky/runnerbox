import { type ReproduceNetwork, subjectKey, type ThreadReference, type ThreadSubject } from "@runnerbox/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Predicate from "effect/Predicate";
import { useEffect, useState } from "react";
import { draftKeyOf, type QueuedDraft, useComposerDraftStore } from "../composerDraftStore.ts";
import { queueOutcome } from "../lib/queuedDrafts.ts";
import { EMPTY_VIEW, foldThread, isReproducing, type ThreadView } from "../lib/threadView.ts";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

type SendOptions = {
  readonly accountId?: string | undefined;
  readonly model?: string | undefined;
  readonly attachments?: ReadonlyArray<string>;
  readonly references?: ReadonlyArray<ThreadReference>;
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");

// The latest thread on a subject, live, and what the dock can do with it. A subject with no thread
// gets one on the first question.
export function useThread(subject: ThreadSubject, days: number) {
  const { environment, connection } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const connected = connection?.status === "connected" ? connection.since : null;
  const key = subjectKey(subject);
  const queryClient = useQueryClient();
  const draftKey = draftKeyOf(environmentId, key);

  // The server decides whether this session may run threads: the scopes saved at pairing can be
  // older than what it grants now.
  const provider = useQuery({
    queryKey: [environmentId, "threads.provider"],
    queryFn: () => runtime.run(environmentId, (client) => client["threads.provider"]()),
    enabled: connected !== null,
    retry: false,
  });
  const permitted = !Predicate.isTagged(provider.error, "AuthorizationError");
  const enabled = provider.isSuccess && connected !== null;
  const latest = useQuery({
    queryKey: [environmentId, "threads", key],
    queryFn: () => runtime.run(environmentId, (client) => client["threads.list"]({ subject })),
    enabled,
  });
  // Set when the user starts a thread here, or asks for a fresh one (null).
  const [chosen, setChosen] = useState<{ key: string; id: string | null } | undefined>();
  const threadId = chosen?.key === key ? chosen.id : (latest.data?.[0]?.id ?? null);

  const [view, setView] = useState<{ id: string; value: ThreadView } | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [key]);
  // Following a server stream is synchronizing with something outside React.
  useEffect(() => {
    if (!enabled || threadId === null) return;
    return runtime.follow(environmentId, (client) => client["threads.subscribe"]({ id: threadId }), (event) => {
      setView((current) => ({ id: threadId, value: foldThread(current?.id === threadId ? current.value : EMPTY_VIEW, event) }));
      // A question this window queued: forget it once sent, and give it back if it won't be. Other
      // windows on the thread show it waiting, but it comes back only where it was written.
      const store = useComposerDraftStore.getState();
      const remembered = store.waiting[draftKey];
      const outcome = queueOutcome(event, remembered);
      if (outcome === "waiting" || remembered === undefined) return;
      store.forgetWaiting(draftKey);
      if (outcome === "returned") {
        store.restore(draftKey, remembered.markdown, remembered.files);
        setError(event._tag === "QueueCleared" && event.reason === "failed" ? `The waiting question couldn't start: ${event.message ?? "the server refused it."} It's back in the composer.` : event._tag === "Snapshot" ? "The server restarted before your waiting question was sent. It's back in the composer." : null);
      }
    });
  }, [enabled, environmentId, threadId, connected, draftKey]);

  const current = threadId !== null && view?.id === threadId ? view.value : EMPTY_VIEW;
  const reproducing = isReproducing(current.items);
  // Whether this thread's job can be reproduced, and whether this session may: the server decides.
  // While a container runs, asking again each minute lets the server notice `up` removed it.
  const reproduce = useQuery({
    queryKey: [environmentId, "threads.checkReproduce", threadId],
    queryFn: () => runtime.run(environmentId, (client) => client["threads.checkReproduce"]({ id: threadId! })),
    enabled: enabled && threadId !== null,
    refetchInterval: reproducing ? 60_000 : false,
    retry: false,
  });
  // The owner's click; the server picks the image from the job's own runner.
  const startReproduce = async (network: ReproduceNetwork) => {
    if (threadId === null) return false;
    setError(null);
    try {
      await runtime.run(environmentId, (client) => client["threads.startReproduce"]({ id: threadId, network }));
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    }
  };
  const stopReproduce = () => {
    if (threadId === null) return;
    runtime.run(environmentId, (client) => client["threads.stopReproduce"]({ id: threadId })).catch((cause: unknown) => setError(errorText(cause)));
  };

  // `accountId` picks the account the turn runs as, and `model` one of its harness's models; without
  // them, the defaults. `attachments` are files this session staged, which the turn takes into the
  // thread, and `references` other threads and runs it brings in as data.
  const send = async (text: string, { accountId, model, attachments = [], references = [] }: SendOptions = {}) => {
    setError(null);
    try {
      let id = threadId;
      if (id === null) {
        id = (await runtime.run(environmentId, (client) => client["threads.create"]({ subject, days }))).id;
        setChosen({ key, id });
        void queryClient.invalidateQueries({ queryKey: [environmentId, "threads", key] });
      }
      const target = id;
      await runtime.run(environmentId, (client) =>
        client["threads.startTurn"]({
          id: target,
          text,
          ...(accountId ? { accountId } : {}),
          ...(model ? { model } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(references.length > 0 ? { references } : {}),
        }),
      );
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    }
  };
  // While a turn runs, a question waits to go when it ends, one per thread. `draft` is what the
  // composer held, so it comes back as it was if it isn't sent. Returns whether it's waiting or went;
  // when it's neither, the caller puts the draft back.
  const queue = async (text: string, options: SendOptions, draft: QueuedDraft) => {
    if (threadId === null) return false;
    setError(null);
    const target = threadId;
    try {
      useComposerDraftStore.getState().rememberWaiting(draftKey, draft);
      const { turnId } = await runtime.run(environmentId, (client) =>
        client["threads.queueTurn"]({
          id: target,
          text,
          ...(options.accountId ? { accountId: options.accountId } : {}),
          ...(options.model ? { model: options.model } : {}),
          ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
          ...(options.references && options.references.length > 0 ? { references: options.references } : {}),
        }),
      );
      // Nothing was running by the time it arrived, so it went at once.
      if (turnId !== null) useComposerDraftStore.getState().forgetWaiting(draftKey);
      return true;
    } catch (cause) {
      useComposerDraftStore.getState().forgetWaiting(draftKey);
      setError(errorText(cause));
      return false;
    }
  };
  // Drops the waiting question; the stream brings its text back to the composer.
  const cancelQueued = () => {
    if (threadId === null) return;
    runtime.run(environmentId, (client) => client["threads.cancelQueued"]({ id: threadId })).catch((cause: unknown) => setError(errorText(cause)));
  };

  const interrupt = () => {
    if (threadId === null) return;
    runtime.run(environmentId, (client) => client["threads.interrupt"]({ id: threadId })).catch((cause: unknown) => setError(errorText(cause)));
  };

  // Removes the thread, its messages and its files, from the server. The subject then has none.
  const remove = async () => {
    if (threadId === null) return false;
    setError(null);
    try {
      await runtime.run(environmentId, (client) => client["threads.delete"]({ id: threadId }));
      setChosen({ key, id: null });
      void queryClient.invalidateQueries({ queryKey: [environmentId, "threads"] });
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    }
  };

  return {
    environmentId,
    // Where the composer keeps this subject's unsent question.
    draftKey,
    permitted,
    provider: provider.data,
    view: current,
    reproduce: { check: reproduce.data ?? null, running: reproducing, start: startReproduce, stop: stopReproduce },
    error,
    send,
    queue,
    cancelQueued,
    remove,
    interrupt,
    startFresh: () => setChosen({ key, id: null }),
  };
}
