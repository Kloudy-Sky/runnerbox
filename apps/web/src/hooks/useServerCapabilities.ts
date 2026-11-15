import { useQuery } from "@tanstack/react-query";
import * as Effect from "effect/Effect";
import { capabilitiesOf, NO_CAPABILITIES } from "../lib/serverCapabilities.ts";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// A server refuses a method it doesn't have this way, rather than with an error of its own.
const isUnknownMethod = (defect: unknown) => String(defect).includes("Unknown request tag");

// What the connected server can do, asked once per connection, since it may have been upgraded in
// between. A reconnect keeps what this environment's server last said until it answers again, so
// controls don't blink out; before its first answer, nothing newer is offered.
export function useServerCapabilities() {
  const { environment, connection } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const connected = connection?.status === "connected" ? connection.since : null;
  const methods = useQuery({
    queryKey: [environmentId, "server.methods", connected],
    queryFn: () =>
      runtime.run(environmentId, (client) =>
        client["server.methods"]().pipe(Effect.catchDefect((defect) => (isUnknownMethod(defect) ? Effect.succeed(null) : Effect.die(defect)))),
      ),
    enabled: connected !== null,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[0] === environmentId ? previous : undefined),
  });
  return methods.isSuccess ? capabilitiesOf(methods.data) : NO_CAPABILITIES;
}
