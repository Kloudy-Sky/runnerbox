// Managed tunnels. The relay creates one Cloudflare Tunnel and DNS record per user and
// environment, routes the hostname to the environment's loopback port, and hands the connector
// token to the environment. Tests use a fake with the same interface.

export type TunnelOrigin = { host: string; port: number };
export type Provisioned = { tunnelId: string; dnsRecordId: string; connectorToken: string };

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
    const json = (await response.json().catch(() => null)) as { success?: boolean; result?: unknown } | null;
    if (!response.ok || !json?.success) throw new Error(`Cloudflare ${method} ${path.split("/").slice(0, 4).join("/")} failed (${response.status})`);
    return json.result;
  };
  const account = `/accounts/${config.accountId}/cfd_tunnel`;
  return {
    baseUrlFor: (hostname) => `https://${hostname}`,
    async provision({ name, hostname, origin, existing, onTunnel }) {
      let tunnelId = existing.tunnelId;
      if (!tunnelId) {
        const created = (await api("POST", account, { name, config_src: "cloudflare" })) as { id: string };
        tunnelId = created.id;
        await onTunnel(tunnelId);
      }
      // Only this hostname reaches the environment, and only its loopback port; anything else 404s.
      await api("PUT", `${account}/${tunnelId}/configurations`, {
        config: { ingress: [{ hostname, service: `http://${origin.host}:${origin.port}` }, { service: "http_status:404" }] },
      });
      let dnsRecordId = existing.dnsRecordId;
      if (!dnsRecordId) {
        const record = (await api("POST", `/zones/${config.zoneId}/dns_records`, { type: "CNAME", name: hostname, content: `${tunnelId}.cfargotunnel.com`, proxied: true })) as { id: string };
        dnsRecordId = record.id;
      }
      const connectorToken = (await api("GET", `${account}/${tunnelId}/token`)) as string;
      return { tunnelId, dnsRecordId, connectorToken };
    },
    async release({ tunnelId, dnsRecordId }) {
      if (dnsRecordId) await api("DELETE", `/zones/${config.zoneId}/dns_records/${dnsRecordId}`);
      if (tunnelId) await api("DELETE", `${account}/${tunnelId}?cascade=true`);
    },
  };
}
