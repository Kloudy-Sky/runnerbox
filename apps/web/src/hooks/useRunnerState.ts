import type { InstallState } from "@runnerbox/contracts";
import { useEffect, useState } from "react";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// Each install's live slot state, pushed by the server whenever it changes. Undefined until the
// first push.
export function useRunnerState() {
  const { environment, connection } = useActiveEnvironment();
  const [installs, setInstalls] = useState<{ environmentId: string; value: ReadonlyArray<InstallState> } | undefined>();
  const environmentId = environment?.environmentId;
  const connected = connection?.status === "connected" ? connection.since : null;
  // Subscribing to a server stream is synchronizing with something outside React.
  useEffect(() => {
    if (!environmentId || connected === null) return;
    return runtime.follow(environmentId, (client) => client["runners.subscribeState"](), (value) => setInstalls({ environmentId, value }));
  }, [environmentId, connected]);
  return installs && installs.environmentId === environmentId ? installs.value : undefined;
}
