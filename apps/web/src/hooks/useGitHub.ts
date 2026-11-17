import type { GitHubStatus } from "@runnerbox/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { runtime } from "../runtime.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRpcQuery } from "./useRpcQuery.ts";
import { useServerCapabilities } from "./useServerCapabilities.ts";

// The environment's sign-in to GitHub: who it's signed in as and where the App is installed. Asked
// again every couple of seconds while a code waits to be approved, since the server learns of the
// approval on its own, and every half minute otherwise, since installs change on GitHub's own
// time. `available` is false on a server older than the sign-in.
export function useGitHub() {
  const { environment } = useActiveEnvironment();
  const environmentId = environment?.environmentId ?? "";
  const { github: available } = useServerCapabilities();
  const queryClient = useQueryClient();
  const waiting = (queryClient.getQueryData<GitHubStatus>([environmentId, "github"])?.pending ?? null) !== null;
  const status = useRpcQuery(["github"], (client) => client["github.status"](), { enabled: available, refetchEvery: waiting ? 2_000 : 30_000 });
  // Every change answers with the status as it now is, so it's shown without asking again. What
  // reviews can read changes with it.
  const show = (next: GitHubStatus) => {
    queryClient.setQueryData([environmentId, "github"], next);
    void queryClient.invalidateQueries({ queryKey: [environmentId, "reviews"] });
  };
  return {
    available,
    status: status.data ?? null,
    signIn: () => runtime.run(environmentId, (client) => client["github.signIn"]()).then(show),
    cancel: () => runtime.run(environmentId, (client) => client["github.cancelSignIn"]()).then(show),
    signOut: () => runtime.run(environmentId, (client) => client["github.signOut"]()).then(show),
  };
}
