import * as Schema from "effect/Schema";

// Managed tunnels. The relay creates one Cloudflare Tunnel and DNS record per user and
// environment, routes the hostname to the environment's loopback port, and hands the connector
// token to the environment. Tests use a fake with the same interface.

export type TunnelOrigin = { host: string; port: number };
export type Provisioned = { tunnelId: string; dnsRecordId: string; connectorToken: string };

// A tunnel as Cloudflare reports it. `down` had connections and lost them at `connsInactiveAt`;
// `inactive` never connected.
export type TunnelStatus = { id: string; name: string; status: string; createdAt: string; connsInactiveAt: string | null };

const TunnelJson = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
  created_at: Schema.String,
  conns_inactive_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  deleted_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const decodeTunnel = Schema.decodeUnknownSync(TunnelJson);

// Cloudflare said to slow down. A sweep stops for this run rather than retrying.
export class RateLimited extends Error {}

export interface TunnelProvider {
  // The public address clients use for this hostname.
  baseUrlFor(hostname: string): string;
  // Creates or reuses the tunnel and DNS record. Reports each as soon as it exists, so the caller
  // can record it before the next step can fail.
  provision(input: {
    name: string;
    hostname: string;
    origin: TunnelOrigin;
    existing: { tunnelId: string | null; dnsRecordId: string | null };
    onTunnel: (tunnelId: string) => Promise<void>;
  }): Promise<Provisioned>;
  release(input: { tunnelId: string | null; dnsRecordId: string | null }): Promise<void>;
  list(input: { status: "down" | "inactive"; namePrefix: string; page: number; perPage: number }): Promise<{ tunnels: TunnelStatus[]; totalCount: number | null }>;
  // Null once the tunnel is deleted.
  get(tunnelId: string): Promise<TunnelStatus | null>;
}

type CloudflareConfig = { accountId: string; zoneId: string; apiToken: string; fetch?: typeof fetch };

export function cloudflareTunnels(config: CloudflareConfig): TunnelProvider {
  const doFetch = config.fetch ?? fetch;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await doFetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      redirect: "manual",
      headers: { authorization: `Bearer ${config.apiToken}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await response.json().catch(() => null)) as { success?: boolean; result?: unknown; result_info?: { total_count?: number } } | null;
    if (response.status === 429) throw new RateLimited("Cloudflare rate limit");
    if (!response.ok || !json?.success) throw new Error(`Cloudflare ${method} ${path.split("/").slice(0, 4).join("/")} failed (${response.status})`);
    return { result: json.result, totalCount: json.result_info?.total_count ?? null };
  };
  const call = async (method: string, path: string, body?: unknown) => (await api(method, path, body)).result;
  const toStatus = (raw: unknown): TunnelStatus => {
    const tunnel = decodeTunnel(raw);
    return { id: tunnel.id, name: tunnel.name, status: tunnel.status, createdAt: tunnel.created_at, connsInactiveAt: tunnel.conns_inactive_at ?? null };
  };
  const account = `/accounts/${config.accountId}/cfd_tunnel`;
  return {
    baseUrlFor: (hostname) => `https://${hostname}`,
    async provision({ name, hostname, origin, existing, onTunnel }) {
      let tunnelId = existing.tunnelId;
      if (!tunnelId) {
        const created = (await call("POST", account, { name, config_src: "cloudflare" })) as { id: string };
        tunnelId = created.id;
        await onTunnel(tunnelId);
      }
      // Only this hostname reaches the environment, and only its loopback port; anything else 404s.
      await call("PUT", `${account}/${tunnelId}/configurations`, {
        config: { ingress: [{ hostname, service: `http://${origin.host}:${origin.port}` }, { service: "http_status:404" }] },
      });
      let dnsRecordId = existing.dnsRecordId;
      const target = { type: "CNAME", name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true };
      if (!dnsRecordId) {
        const record = (await call("POST", `/zones/${config.zoneId}/dns_records`, target)) as { id: string };
        dnsRecordId = record.id;
      } else if (!existing.tunnelId) {
        // A replacement tunnel under the same hostname: the record stays and points at the new one.
        await call("PATCH", `/zones/${config.zoneId}/dns_records/${dnsRecordId}`, target);
      }
      const connectorToken = (await call("GET", `${account}/${tunnelId}/token`)) as string;
      return { tunnelId, dnsRecordId, connectorToken };
    },
    async release({ tunnelId, dnsRecordId }) {
      if (dnsRecordId) await call("DELETE", `/zones/${config.zoneId}/dns_records/${dnsRecordId}`);
      if (tunnelId) await call("DELETE", `${account}/${tunnelId}?cascade=true`);
    },
    async list({ status, namePrefix, page, perPage }) {
      const query = new URLSearchParams({ is_deleted: "false", status, include_prefix: namePrefix, page: String(page), per_page: String(perPage) });
      const { result, totalCount } = await api("GET", `${account}?${query}`);
      return { tunnels: (result as unknown[]).map(toStatus), totalCount };
    },
    async get(tunnelId) {
      const tunnel = decodeTunnel(await call("GET", `${account}/${tunnelId}`));
      return tunnel.deleted_at ? null : toStatus(tunnel);
    },
  };
}
