import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { GitHubStatus } from "@runnerbox/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry.ts";
import { runtime } from "../runtime.ts";
import { capabilitiesAtom } from "../state/connections.ts";
import { githubAtom } from "../state/github.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";

// The active environment's sign-in to GitHub: who it's signed in as and where the App is
// installed. `available` is false on a server older than the sign-in.
export function useGitHub() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const status = useAtomValue(githubAtom(environmentId));
  const write = useAtomSet(githubAtom(environmentId));
  // Every change answers with the status as it now is, which is shown at once. Asking again too
  // restarts the pace from that answer, so a code waiting to be approved is asked about every
  // couple of seconds rather than at the next half minute.
  const show = (next: GitHubStatus) => {
    appAtomRegistry.refresh(githubAtom(environmentId));
    write(next);
  };
  return {
    available: useAtomValue(capabilitiesAtom(environmentId)).github,
    status: Option.getOrNull(AsyncResult.value(status)),
    signIn: () => runtime.run(environmentId, (client) => client["github.signIn"]()).then(show),
    cancel: () => runtime.run(environmentId, (client) => client["github.cancelSignIn"]()).then(show),
    signOut: () => runtime.run(environmentId, (client) => client["github.signOut"]()).then(show),
  };
}
