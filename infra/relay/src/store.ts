// The subset of Cloudflare D1 the relay uses. A D1 binding satisfies it, and tests back it with
// node:sqlite, so the same SQL runs in both.
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
}

export type Link = {
  user_id: string;
  environment_id: string;
  label: string;
  environment_public_key: string;
  http_base_url: string;
  linked_at: string;
};

export type Allocation = {
  user_id: string;
  environment_id: string;
  hostname: string;
  http_base_url: string;
  tunnel_id: string | null;
  dns_record_id: string | null;
  origin_host: string;
  origin_port: number;
  state: "provisioning" | "ready" | "deleting";
  generation: number;
  updated_at: string;
  recovery_registered_at: string | null;
  tunnel_released_at: string | null;
};

type Key = { userId: string; environmentId: string };

export function createStore(db: D1Like, now: () => number) {
  const iso = () => new Date(now()).toISOString();
  return {
    // True the first time a key is seen; false on a replay. Expired keys are swept on the way.
    async consumeOnce(key: string, expiresAt: number) {
      await db.prepare("DELETE FROM used_nonces WHERE expires_at < ?").bind(now()).run();
      const { meta } = await db.prepare("INSERT OR IGNORE INTO used_nonces (key, expires_at) VALUES (?, ?)").bind(key, expiresAt).run();
      return meta.changes === 1;
    },

    link: ({ userId, environmentId }: Key) =>
      db.prepare("SELECT * FROM links WHERE user_id = ? AND environment_id = ?").bind(userId, environmentId).first<Link>(),
    linksForUser: async (userId: string) =>
      (await db.prepare("SELECT * FROM links WHERE user_id = ? ORDER BY linked_at").bind(userId).all<Link>()).results,
    linksForEnvironment: async (environmentId: string) =>
      (await db.prepare("SELECT * FROM links WHERE environment_id = ?").bind(environmentId).all<Link>()).results,
    upsertLink: (link: Omit<Link, "linked_at">) =>
      db
        .prepare(
          `INSERT INTO links (user_id, environment_id, label, environment_public_key, http_base_url, linked_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, environment_id) DO UPDATE SET label = excluded.label, environment_public_key = excluded.environment_public_key, http_base_url = excluded.http_base_url`,
        )
        .bind(link.user_id, link.environment_id, link.label, link.environment_public_key, link.http_base_url, iso())
        .run(),
    deleteLink: ({ userId, environmentId }: Key) =>
      db.prepare("DELETE FROM links WHERE user_id = ? AND environment_id = ?").bind(userId, environmentId).run(),

    allocation: ({ userId, environmentId }: Key) =>
      db.prepare("SELECT * FROM allocations WHERE user_id = ? AND environment_id = ?").bind(userId, environmentId).first<Allocation>(),
    // Starts or restarts provisioning, bumping the generation so any teardown in flight stands down.
    async beginAllocation(key: Key, fields: { hostname: string; httpBaseUrl: string; originHost: string; originPort: number }) {
      await db
        .prepare(
          `INSERT INTO allocations (user_id, environment_id, hostname, http_base_url, origin_host, origin_port, state, generation, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'provisioning', 1, ?)
           ON CONFLICT (user_id, environment_id) DO UPDATE SET origin_host = excluded.origin_host, origin_port = excluded.origin_port,
             state = 'provisioning', generation = allocations.generation + 1, updated_at = excluded.updated_at`,
        )
        .bind(key.userId, key.environmentId, fields.hostname, fields.httpBaseUrl, fields.originHost, fields.originPort, iso())
        .run();
      return (await db.prepare("SELECT * FROM allocations WHERE user_id = ? AND environment_id = ?").bind(key.userId, key.environmentId).first<Allocation>())!;
    },
    // Records each external resource as soon as it exists, so a retry reuses it.
    checkpoint: (key: Key, generation: number, fields: { tunnelId?: string; dnsRecordId?: string; ready?: boolean }) =>
      db
        .prepare(
          `UPDATE allocations SET tunnel_id = COALESCE(?, tunnel_id), dns_record_id = COALESCE(?, dns_record_id),
             state = CASE WHEN ? THEN 'ready' ELSE state END,
             tunnel_released_at = CASE WHEN ? THEN NULL ELSE tunnel_released_at END, updated_at = ?
           WHERE user_id = ? AND environment_id = ? AND generation = ?`,
        )
        .bind(fields.tunnelId ?? null, fields.dnsRecordId ?? null, fields.ready ? 1 : 0, fields.ready ? 1 : 0, iso(), key.userId, key.environmentId, generation)
        .run(),
    allocationByTunnel: (tunnelId: string) => db.prepare("SELECT * FROM allocations WHERE tunnel_id = ?").bind(tunnelId).first<Allocation>(),
    allocationByHostname: (hostname: string) => db.prepare("SELECT * FROM allocations WHERE hostname = ?").bind(hostname).first<Allocation>(),
    // The host can replace its tunnel. Bumps the generation, so a reclaim that read the allocation
    // before this can't go on to delete the tunnel the host just showed it's using.
    registerRecovery: (key: Key, generation: number) =>
      db
        .prepare("UPDATE allocations SET recovery_registered_at = ?, generation = generation + 1, updated_at = ? WHERE user_id = ? AND environment_id = ? AND generation = ?")
        .bind(iso(), iso(), key.userId, key.environmentId, generation)
        .run()
        .then(({ meta }) => meta.changes === 1),
    // Claims the allocation's tunnel for reclaim at the generation and tunnel the sweep read. The
    // tunnel ID is cleared before deleting it, so nothing hands out an address for a tunnel going away.
    async claimTunnelRelease(key: Key, generation: number, tunnelId: string) {
      const { meta } = await db
        .prepare(
          `UPDATE allocations SET tunnel_id = NULL, tunnel_released_at = ?, generation = generation + 1, updated_at = ?
           WHERE user_id = ? AND environment_id = ? AND generation = ? AND tunnel_id = ? AND state = 'ready'`,
        )
        .bind(iso(), iso(), key.userId, key.environmentId, generation, tunnelId)
        .run();
      return meta.changes === 1;
    },
    // Undoes a claim whose delete failed, unless something changed the allocation since.
    restoreTunnel: (key: Key, claimedGeneration: number, tunnelId: string) =>
      db
        .prepare("UPDATE allocations SET tunnel_id = ?, tunnel_released_at = NULL, updated_at = ? WHERE user_id = ? AND environment_id = ? AND generation = ? AND tunnel_id IS NULL")
        .bind(tunnelId, iso(), key.userId, key.environmentId, claimedGeneration)
        .run(),
    // Claims the allocation for teardown at the generation the caller read. False when anything
    // changed since, in which case the caller must not touch the tunnel.
    async claimForTeardown(key: Key, generation: number) {
      const { meta } = await db
        .prepare("UPDATE allocations SET state = 'deleting', generation = generation + 1, updated_at = ? WHERE user_id = ? AND environment_id = ? AND generation = ?")
        .bind(iso(), key.userId, key.environmentId, generation)
        .run();
      return meta.changes === 1;
    },
    deleteClaimed: (key: Key, claimedGeneration: number) =>
      db.prepare("DELETE FROM allocations WHERE user_id = ? AND environment_id = ? AND generation = ? AND state = 'deleting'").bind(key.userId, key.environmentId, claimedGeneration).run(),
  };
}

export type RelayStore = ReturnType<typeof createStore>;
