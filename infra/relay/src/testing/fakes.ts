import type { IdentityVerifier } from "../identity.ts";
import { RateLimited, type TunnelProvider, type TunnelStatus } from "../tunnels.ts";

// Clerk, as a fixed map from token to user.
export const fakeIdentity = (users: Record<string, string>): IdentityVerifier => ({ verify: async (token) => (users[token] ? { userId: users[token] } : null) });

// Cloudflare, as a table of tunnels and a record of what was asked. Every hostname routes to
// `target`, the local server. Tests set a tunnel's status and age, can make the next list
// rate-limited, and can run something just before the sweep's final status check.
export function fakeTunnels(target: () => string) {
  const calls: string[] = [];
  const tunnels = new Map<string, TunnelStatus>();
  let next = 0;
  const hooks: { beforeGet?: ((tunnelId: string) => Promise<void>) | undefined; rateLimitLists?: boolean } = {};
  const provider: TunnelProvider = {
    baseUrlFor: () => target(),
    async provision({ name, hostname, origin, existing, onTunnel }) {
      let tunnelId = existing.tunnelId;
      if (!tunnelId) {
        tunnelId = `tunnel-${++next}`;
        tunnels.set(tunnelId, { id: tunnelId, name, status: "healthy", createdAt: new Date().toISOString(), connsInactiveAt: null });
        await onTunnel(tunnelId);
      }
      calls.push(`provision ${tunnelId} ${hostname} -> ${origin.host}:${origin.port}${existing.dnsRecordId && !existing.tunnelId ? " (dns repointed)" : ""}`);
      return { tunnelId, dnsRecordId: existing.dnsRecordId ?? `dns-${tunnelId}`, connectorToken: `connector-token-for-${tunnelId}` };
    },
    async release({ tunnelId, dnsRecordId }) {
      calls.push(`release ${tunnelId}${dnsRecordId ? ` and ${dnsRecordId}` : ""}`);
      if (tunnelId) tunnels.delete(tunnelId);
    },
    async list({ status, namePrefix }) {
      if (hooks.rateLimitLists) throw new RateLimited("fake rate limit");
      calls.push(`list ${status}`);
      const matching = [...tunnels.values()].filter((tunnel) => tunnel.status === status && tunnel.name.startsWith(namePrefix));
      return { tunnels: matching, totalCount: matching.length };
    },
    async get(tunnelId) {
      await hooks.beforeGet?.(tunnelId);
      return tunnels.get(tunnelId) ?? null;
    },
  };
  // Marks a tunnel down since `minutesAgo`, as Cloudflare reports one whose connector went away.
  const goDown = (tunnelId: string, minutesAgo: number) => {
    const tunnel = tunnels.get(tunnelId);
    if (tunnel) tunnels.set(tunnelId, { ...tunnel, status: "down", connsInactiveAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() });
  };
  return { provider, calls, tunnels, hooks, goDown };
}
