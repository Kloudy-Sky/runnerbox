import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useStore } from "zustand";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";
import { Heading } from "./Heading.tsx";

const field = "bg-surf px-2 py-0.5 text-fg outline-none placeholder:text-faint";

// Runnerbox Connect: sign in once, then reach any environment linked to the same account through
// its managed tunnel. Sessions bought this way read and nothing more.
export function ConnectSection() {
  const connect = runtime.connect;
  const queryClient = useQueryClient();
  const environments = useStore(runtime.store, (state) => state.environments);
  const setActive = usePreferences((state) => state.setActive);
  const [relayUrl, setRelayUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["connect", "status"], queryFn: () => connect!.status(), enabled: connect !== undefined, refetchInterval: false });
  const linked = useQuery({ queryKey: ["connect", "environments"], queryFn: () => connect!.environments(), enabled: status.data?.signedIn === true });
  if (!connect || !status.data) return null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connect"] });
  const attempt = (run: () => Promise<unknown>) => {
    setError(null);
    run().then(refresh, (failure: unknown) => setError(failure instanceof Error ? failure.message : "That didn't work."));
  };

  return (
    <div>
      <Heading>Runnerbox Connect</Heading>
      {status.data.signedIn ? (
        <>
          <div className="flex items-baseline gap-3 pb-1">
            <span className="text-dim">Signed in at {status.data.relayUrl}</span>
            <button type="button" className="text-dim hover:text-fg" onClick={() => attempt(() => connect.signOut())}>Sign out</button>
          </div>
          {linked.data?.length === 0 ? <p className="text-dim">No environments linked to this account. On a machine, run runnerbox-server link.</p> : null}
          <table className="border-collapse">
            <tbody>
              {(linked.data ?? []).map((environment) => {
                const added = environments.some((saved) => saved.environmentId === environment.environmentId && saved.routes.some((route) => route.kind === "connect"));
                return (
                  <tr key={environment.environmentId}>
                    <td className="py-0.5 pr-4">{environment.label}</td>
                    <td className="py-0.5 pr-4 text-dim">{new URL(environment.httpBaseUrl).host}</td>
                    <td className="py-0.5">
                      {added ? (
                        <span className="text-dim">added</span>
                      ) : (
                        <button type="button" className="text-fg" onClick={() => attempt(() => runtime.addConnectRoute(environment, status.data.relayUrl!).then((saved) => setActive(saved.environmentId)))}>
                          Add
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      ) : (
        <form
          className="flex items-center gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            attempt(() => connect.signIn(relayUrl.trim()));
          }}
        >
          <input className={`${field} w-80`} value={relayUrl} placeholder="https://relay.example.com" onChange={(event) => setRelayUrl(event.target.value)} />
          <button type="submit" className="bg-surf2 px-3 py-0.5">Sign in</button>
        </form>
      )}
      {error ? <p className="pt-1 text-red">{error}</p> : null}
    </div>
  );
}
