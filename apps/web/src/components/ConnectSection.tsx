import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Input } from "./ui/input.tsx";
import { Button } from "./ui/button.tsx";
import { useState } from "react";
import { useStore } from "zustand";
import { runtime } from "../runtime.ts";
import { usePreferences } from "../state/preferences.ts";
import { Heading } from "./Heading.tsx";


// Runnerbox Connect: sign in once, then reach any environment linked to the same account through
// its managed tunnel. Sessions bought this way read and nothing more.
export function ConnectSection() {
  const connect = runtime.connect;
  const queryClient = useQueryClient();
  const environments = useStore(runtime.store, (state) => state.environments);
  const setActive = usePreferences((state) => state.setActive);
  const [relayUrl, setRelayUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["connect", "status"], queryFn: () => (connect ? connect.status() : Promise.reject(new Error("Connect isn't available here."))), enabled: connect !== undefined, refetchInterval: false });
  const linked = useQuery({ queryKey: ["connect", "environments"], queryFn: () => (connect ? connect.environments() : Promise.reject(new Error("Connect isn't available here."))), enabled: status.data?.signedIn === true });
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
            <span className="text-muted-foreground">Signed in at {status.data.relayUrl}</span>
            <Button variant="ghost-muted" size="xs" onClick={() => attempt(() => connect.signOut())}>Sign out</Button>
          </div>
          {linked.data?.length === 0 ? <p className="text-muted-foreground">No environments linked to this account. On a machine, run runnerbox link.</p> : null}
          <table className="border-collapse">
            <tbody>
              {(linked.data ?? []).map((environment) => {
                const added = environments.some((saved) => saved.environmentId === environment.environmentId && saved.routes.some((route) => route.kind === "connect"));
                return (
                  <tr key={environment.environmentId}>
                    <td className="py-0.5 pr-4">{environment.label}</td>
                    <td className="py-0.5 pr-4 text-muted-foreground">{new URL(environment.httpBaseUrl).host}</td>
                    <td className="py-0.5">
                      {added ? (
                        <span className="text-muted-foreground">added</span>
                      ) : (
                        <Button variant="secondary" size="xs" onClick={() => attempt(() => runtime.addConnectRoute(environment, status.data.relayUrl!).then((saved) => setActive(saved.environmentId)))}>
                          Add
                        </Button>
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
          <Input className="w-80" value={relayUrl} placeholder="https://relay.example.com" onChange={(event) => setRelayUrl(event.target.value)} />
          <Button type="submit" variant="secondary">Sign in</Button>
        </form>
      )}
      {error ? <p className="pt-1 text-destructive">{error}</p> : null}
    </div>
  );
}
