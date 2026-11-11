import type { RelayStore } from "./store.ts";
import { RateLimited, type TunnelProvider, type TunnelStatus } from "./tunnels.ts";

// Reclaims idle managed tunnels, after T3 Code's reaper. Cloudflare may bill a tunnel whether or
// not a connector is attached, so a machine that sleeps leaves one behind. A sweep deletes only the
// tunnel, keeping the allocation and its DNS record, and only when the host has registered that it
// can ask for a replacement under the same hostname.

export type CleanupMode = "off" | "dry-run" | "enabled";

export const TUNNEL_NAME = /^rbx-[0-9a-f]{16}$/;
const DOWN_GRACE_MS = 5 * 60_000;
// A tunnel that never connected may belong to a link still being set up.
const NEVER_CONNECTED_GRACE_MS = 60 * 60_000;
const PAGE_SIZE = 100;
const LIST_REQUEST_LIMIT = 10;
const DELETE_LIMIT = 100;
// Inside the scheduled run's time limit, with room to report.
const DELETE_BUDGET_MS = 90_000;

export type SweepResult = {
  mode: CleanupMode;
  listRequests: number;
  candidates: number;
  attempted: number;
  deleted: number;
  wouldDelete: number;
  // A tunnel with no allocation at all is never deleted: with no row to claim, a relink that adopts
  // it by name could race the delete. Clear those by hand.
  skippedOrphan: number;
  // The allocation now has another tunnel.
  skippedReplaced: number;
  // The host never registered recovery, so it couldn't replace a deleted tunnel.
  skippedNoRecovery: number;
  // The tunnel came back, or the host touched the allocation, between listing and deleting.
  skippedReconnected: number;
  failed: number;
  truncated: boolean;
};

const idleSince = (tunnel: TunnelStatus, status: "down" | "inactive") => Date.parse((status === "down" ? tunnel.connsInactiveAt : tunnel.createdAt) ?? "");

export async function sweepIdleTunnels(deps: { store: RelayStore; tunnels: TunnelProvider; mode: CleanupMode; tunnelBaseDomain: string; now: () => number }): Promise<SweepResult> {
  const { store, tunnels, mode, now } = deps;
  const result: SweepResult = {
    mode,
    listRequests: 0,
    candidates: 0,
    attempted: 0,
    deleted: 0,
    wouldDelete: 0,
    skippedOrphan: 0,
    skippedReplaced: 0,
    skippedNoRecovery: 0,
    skippedReconnected: 0,
    failed: 0,
    truncated: false,
  };
  if (mode === "off") return result;
  const started = now();
  const isIdle = (tunnel: TunnelStatus, status: "down" | "inactive") =>
    TUNNEL_NAME.test(tunnel.name) && tunnel.status === status && idleSince(tunnel, status) <= started - (status === "down" ? DOWN_GRACE_MS : NEVER_CONNECTED_GRACE_MS);

  const found = new Map<string, { tunnel: TunnelStatus; status: "down" | "inactive" }>();
  try {
    for (const status of ["down", "inactive"] as const) {
      for (let page = 1; result.listRequests < LIST_REQUEST_LIMIT; page++) {
        result.listRequests++;
        const { tunnels: listed, totalCount } = await tunnels.list({ status, namePrefix: "rbx-", page, perPage: PAGE_SIZE });
        for (const tunnel of listed) if (isIdle(tunnel, status)) found.set(tunnel.id, { tunnel, status });
        const more = totalCount === null ? listed.length === PAGE_SIZE : page * PAGE_SIZE < totalCount;
        if (!more) break;
        if (result.listRequests >= LIST_REQUEST_LIMIT) result.truncated = true;
      }
    }
  } catch (error) {
    if (!(error instanceof RateLimited)) throw error;
    result.truncated = true;
  }

  // Each sweep starts one budget further along, so a block of deletes that keep failing can't
  // starve the tunnels listed after them.
  const candidates = [...found.values()].toSorted((a, b) => a.tunnel.id.localeCompare(b.tunnel.id));
  result.candidates = candidates.length;
  const slot = Math.floor(started / DOWN_GRACE_MS);
  const offset = candidates.length === 0 ? 0 : (slot * DELETE_LIMIT) % candidates.length;
  const ordered = [...candidates.slice(offset), ...candidates.slice(0, offset)];

  for (const { tunnel, status } of ordered) {
    const allocation = await store.allocationByTunnel(tunnel.id);
    if (!allocation) {
      if (await store.allocationByHostname(`${tunnel.name}.${deps.tunnelBaseDomain}`)) result.skippedReplaced++;
      else result.skippedOrphan++;
      continue;
    }
    if (allocation.recovery_registered_at === null) {
      result.skippedNoRecovery++;
      continue;
    }
    if (mode === "dry-run") {
      result.wouldDelete++;
      continue;
    }
    if (result.attempted >= DELETE_LIMIT || now() - started >= DELETE_BUDGET_MS) {
      result.truncated = true;
      break;
    }
    result.attempted++;
    try {
      // Look once more: a connector that came back reconnects to Cloudflare, not to us.
      const current = await tunnels.get(tunnel.id);
      const key = { userId: allocation.user_id, environmentId: allocation.environment_id };
      if (!current || !isIdle(current, status) || !(await store.claimTunnelRelease(key, allocation.generation, tunnel.id))) {
        result.skippedReconnected++;
        continue;
      }
      try {
        await tunnels.release({ tunnelId: tunnel.id, dnsRecordId: null });
        result.deleted++;
      } catch (error) {
        await store.restoreTunnel(key, allocation.generation + 1, tunnel.id);
        throw error;
      }
    } catch (error) {
      result.failed++;
      if (error instanceof RateLimited) {
        result.truncated = true;
        break;
      }
    }
  }
  return result;
}
