import { type ReproduceNetwork, subjectKey, type ThreadSubject } from "@runnerbox/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Predicate from "effect/Predicate";
import { useEffect, useState } from "react";
import { EMPTY_VIEW, foldThread, isReproducing, type ThreadView } from "../lib/threadView.ts";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

const errorText = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");

// The latest thread on a subject, live, and what the dock can do with it. A subject with no thread
// gets one on the first question.
export function useThread(subject: ThreadSubject, days: number) {
  const { environment, connection } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const connected = connection?.status === "connected" ? connection.since : null;
  const key = subjectKey(subject);
  const queryClient = useQueryClient();

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
    return runtime.follow(environmentId, (client) => client["threads.subscribe"]({ id: threadId }), (event) =>
      setView((current) => ({ id: threadId, value: foldThread(current?.id === threadId ? current.value : EMPTY_VIEW, event) })),
    );
  }, [enabled, environmentId, threadId, connected]);

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

  // `accountId` picks the account the turn runs as; without it, the default.
  const send = async (text: string, accountId?: string) => {
    setError(null);
    try {
      let id = threadId;
      if (id === null) {
        id = (await runtime.run(environmentId, (client) => client["threads.create"]({ subject, days }))).id;
        setChosen({ key, id });
        void queryClient.invalidateQueries({ queryKey: [environmentId, "threads", key] });
      }
      const target = id;
      await runtime.run(environmentId, (client) => client["threads.startTurn"]({ id: target, text, ...(accountId ? { accountId } : {}) }));
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    }
  };
  const interrupt = () => {
    if (threadId === null) return;
    runtime.run(environmentId, (client) => client["threads.interrupt"]({ id: threadId })).catch((cause: unknown) => setError(errorText(cause)));
  };

  return {
    permitted,
    provider: provider.data,
    view: current,
    reproduce: { check: reproduce.data ?? null, running: reproducing, start: startReproduce, stop: stopReproduce },
    error,
    send,
    interrupt,
    startFresh: () => setChosen({ key, id: null }),
  };
}
