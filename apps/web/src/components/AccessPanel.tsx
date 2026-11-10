import type { PairingCode } from "@runnerbox/contracts";
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
              <td className="py-0.5 pr-3">{session.label}{session.current ? <span className="text-dim"> this app</span> : null}</td>
              <td className="py-0.5 pr-3 text-dim">{session.audience === "mcp" ? "agent" : "app"}</td>
              <td className="py-0.5 pr-3 text-dim">{session.scopes.join(" ")}</td>
              <td className="py-0.5 pr-3 text-dim">seen {formatAge(session.lastSeenAt ?? session.createdAt)} ago</td>
              <td className="py-0.5 text-right">
                {session.current ? null : (
                  <button type="button" className="text-dim hover:text-red" onClick={() => void runtime.run(environmentId, (client) => client["access.revokeSession"]({ id: session.id })).then(refresh)}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 pt-2">
        <button type="button" className="bg-surf2 px-3 py-0.5" onClick={() => void runtime.run(environmentId, (client) => client["access.createPairingCode"]({ scopes: ["history:read", "runners:read"] })).then(setCode)}>
          New read-only pairing code
        </button>
        {code ? <span className="font-mono">{code.code}</span> : null}
        {code ? <span className="text-dim">works once, until {new Date(code.expiresAt).toLocaleTimeString()}</span> : null}
      </div>
    </div>
  );
}
