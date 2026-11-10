import type { IdentityVerifier } from "../identity.ts";
import type { TunnelProvider } from "../tunnels.ts";

// Clerk, as a fixed map from token to user.
export const fakeIdentity = (users: Record<string, string>): IdentityVerifier => ({ verify: async (token) => (users[token] ? { userId: users[token] } : null) });

// Cloudflare, as a record of what was asked. Every hostname routes to `target`, the local server.
export function fakeTunnels(target: () => string) {
  const calls: string[] = [];
  let next = 0;
  const provider: TunnelProvider = {
    baseUrlFor: () => target(),
    async provision({ hostname, origin, existing, onTunnel }) {
      const tunnelId = existing.tunnelId ?? `tunnel-${++next}`;
      if (!existing.tunnelId) await onTunnel(tunnelId);
      calls.push(`provision ${tunnelId} ${hostname} -> ${origin.host}:${origin.port}`);
      return { tunnelId, dnsRecordId: existing.dnsRecordId ?? `dns-${tunnelId}`, connectorToken: `connector-token-for-${tunnelId}` };
    },
    async release({ tunnelId }) {
      calls.push(`release ${tunnelId}`);
    },
  };
  return { provider, calls };
}
