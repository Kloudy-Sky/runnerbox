import { queryOptions, useQuery } from "@tanstack/react-query";
import * as Effect from "effect/Effect";
import { capabilitiesOf, NO_CAPABILITIES } from "../lib/serverCapabilities.ts";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// A server refuses a method it doesn't have this way, rather than with an error of its own.
const isUnknownMethod = (defect: unknown) => String(defect).includes("Unknown request tag");

// What an environment's server answers, asked once per connection (`connectedSince`), since it may
// have been upgraded in between. Null from a server older than being asked.
export const methodsQuery = (environmentId: string, connectedSince: number | null) =>
  queryOptions({
    queryKey: [environmentId, "server.methods", connectedSince],
    queryFn: () =>
      runtime.run(environmentId, (client) =>
        client["server.methods"]().pipe(Effect.catchDefect((defect) => (isUnknownMethod(defect) ? Effect.succeed(null) : Effect.die(defect)))),
      ),
    enabled: connectedSince !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

// What the connected server can do. A reconnect keeps what this environment's server last said
// until it answers again, so controls don't blink out; before its first answer, nothing newer is
// offered. `known` is false until it has answered, for a control that says something different
// for an older server.
export function useServerCapabilityState() {
  const { environment, connection } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const connected = connection?.status === "connected" ? connection.since : null;
  const methods = useQuery({
    ...methodsQuery(environmentId, connected),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[0] === environmentId ? previous : undefined),
  });
  return methods.isSuccess ? { capabilities: capabilitiesOf(methods.data), known: true } : { capabilities: NO_CAPABILITIES, known: false };
}

export const useServerCapabilities = () => useServerCapabilityState().capabilities;
