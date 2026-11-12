import type { PairingCode } from "@runnerbox/contracts";
import { Button } from "./ui/button.tsx";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useActiveEnvironment } from "../hooks/useEnvironment.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatAge } from "../lib/format.ts";
import { runtime } from "../runtime.ts";
import { Heading } from "./Heading.tsx";

// Who can reach the active environment, for sessions holding `access:write`.
export function AccessPanel() {
  const { environment } = useActiveEnvironment();
  const queryClient = useQueryClient();
  const sessions = useRpcQuery(["sessions"], (client) => client["access.sessions"]());
  const [code, setCode] = useState<PairingCode | null>(null);
  const environmentId = environment!.environmentId;
  const refresh = () => queryClient.invalidateQueries({ queryKey: [environmentId, "sessions"] });
  return (
    <div>
      <Heading>Who can reach {environment!.label}</Heading>
      <table className="w-full border-collapse">
        <tbody>
          {(sessions.data ?? []).map((session) => (
            <tr key={session.id}>
              <td className="py-0.5 pr-3">{session.label}{session.current ? <span className="text-muted-foreground"> this app</span> : null}</td>
              <td className="py-0.5 pr-3 text-muted-foreground">{session.audience === "mcp" ? "agent" : "app"}</td>
              <td className="py-0.5 pr-3 text-muted-foreground">{session.scopes.join(" ")}</td>
              <td className="py-0.5 pr-3 text-muted-foreground">seen {formatAge(session.lastSeenAt ?? session.createdAt)} ago</td>
              <td className="py-0.5 text-right">
                {session.current ? null : (
                  <Button variant="destructive" size="xs" onClick={() => void runtime.run(environmentId, (client) => client["access.revokeSession"]({ id: session.id })).then(refresh)}>
                    Revoke
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 pt-2">
        <Button variant="secondary" onClick={() => void runtime.run(environmentId, (client) => client["access.createPairingCode"]({ scopes: ["history:read", "runners:read"] })).then(setCode)}>
          New read-only pairing code
        </Button>
        {code ? <span className="font-mono">{code.code}</span> : null}
        {code ? <span className="text-muted-foreground">works once, until {new Date(code.expiresAt).toLocaleTimeString()}</span> : null}
      </div>
    </div>
  );
}
