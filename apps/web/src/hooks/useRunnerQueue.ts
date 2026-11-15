import type { QueueView } from "@runnerbox/contracts";
import { useEffect, useState } from "react";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// The jobs GitHub has queued for this machine's runners, pushed by the server. Watching is what
// makes the server ask GitHub, so only a view that shows them should call this. Undefined until
// the first push, or on a server too old to have it.
export function useRunnerQueue() {
  const { environment, connection } = useActiveEnvironment();
  const { waitingJobs } = useServerCapabilities();
  const [queue, setQueue] = useState<{ environmentId: string; value: QueueView } | undefined>();
  const environmentId = environment?.environmentId;
  const connected = connection?.status === "connected" ? connection.since : null;
  // Subscribing to a server stream is synchronizing with something outside React.
  useEffect(() => {
    if (!environmentId || connected === null || !waitingJobs) return;
    return runtime.follow(environmentId, (client) => client["runners.subscribeQueue"](), (value) => setQueue({ environmentId, value }));
  }, [environmentId, connected, waitingJobs]);
  return queue && queue.environmentId === environmentId ? queue.value : undefined;
}
