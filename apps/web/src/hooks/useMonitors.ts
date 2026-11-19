import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { MonitorSettings } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useEffect, useRef } from "react";
import { appAtomRegistry } from "../rpc/atomRegistry.ts";
import { runtime } from "../runtime.ts";
import { monitorsAtom } from "../state/inbox.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// The active environment's monitor: its settings, today's looks and what they cost, recent runs,
// and items it looked into that the owner hasn't opened. Asked again as soon as a look in progress
// ends, besides every minute.
export function useMonitors() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const status = Option.getOrNull(AsyncResult.value(useAtomValue(monitorsAtom(environmentId))));
  // Saving answers with the status as it now is, so it's shown without asking again.
  const write = useAtomSet(monitorsAtom(environmentId));
  const looking = status?.runs.find((run) => run.outcome === "running")?.threadId ?? null;
  // Following the look's thread is synchronizing with something outside React. When its turn ends,
  // the status is asked again. A snapshot that ends in TurnEnded means the status was fetched before
  // the server recorded the end, so subscribing again after each answer asks until it has, at most
  // once per ended turn.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (looking === null) return;
    return runtime.follow(environmentId, (client) => client["threads.subscribe"]({ id: looking }), (event) => {
      const ended = event._tag === "TurnEnded" ? event : event._tag === "Snapshot" ? event.detail.items.at(-1) : undefined;
      if (ended?._tag !== "TurnEnded" || askedFor.current === ended.turnId) return;
      askedFor.current = ended.turnId;
      appAtomRegistry.refresh(monitorsAtom(environmentId));
    });
  }, [environmentId, looking, status]);
  return {
    status,
    save: (settings: MonitorSettings) => runtime.run(environmentId, (client) => client["monitors.save"](settings)).then(write),
  };
}
