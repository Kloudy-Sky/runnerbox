import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { capabilitiesAtom, serverMethodsAtom } from "../state/connections.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// What the active environment's server can do. A reconnect keeps what its server last said until it
// answers again, so controls don't blink out; before its first answer, nothing newer is offered.
// `known` is false until it has answered, for a control that says something different for an
// older server.
export function useServerCapabilityState() {
  const environmentId = useActiveEnvironment().environment?.environmentId ?? "";
  const capabilities = useAtomValue(capabilitiesAtom(environmentId));
  const known = Option.isSome(AsyncResult.value(useAtomValue(serverMethodsAtom(environmentId))));
  return { capabilities, known };
}

export const useServerCapabilities = () => useServerCapabilityState().capabilities;
