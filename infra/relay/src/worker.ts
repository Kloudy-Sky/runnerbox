import { clerkIdentity } from "./identity.ts";
import type { CleanupMode } from "./reaper.ts";
import { createRelay } from "./relay.ts";
import { createStore, type D1Like } from "./store.ts";
import { cloudflareTunnels } from "./tunnels.ts";

// The Cloudflare Worker entry. Every account-specific value is a binding set at deploy time; see
// docs/connect-setup.md. Nothing here is specific to one deployment.
export type Env = {
  DB: D1Like;
  RELAY_ISSUER: string;
  RELAY_SIGNING_PRIVATE_KEY: string;
  RELAY_SIGNING_PUBLIC_KEY: string;
  CLERK_FRONTEND_API: string;
  CLERK_CLI_CLIENT_ID: string;
  CLERK_DESKTOP_CLIENT_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  TUNNEL_BASE_DOMAIN: string;
  // off (default), dry-run or enabled. See docs/connect-setup.md.
  RELAY_TUNNEL_CLEANUP_MODE?: string;
};

// Wrangler stores PEM secrets with escaped newlines.
const pem = (value: string) => value.replace(/\\n/g, "\n");

const cleanupMode = (value: string | undefined): CleanupMode => (value === "dry-run" || value === "enabled" ? value : "off");

function relayFor(env: Env) {
  const now = () => Date.now();
  return createRelay({
      config: {
        issuer: env.RELAY_ISSUER,
        signingPrivateKey: pem(env.RELAY_SIGNING_PRIVATE_KEY),
        signingPublicKey: pem(env.RELAY_SIGNING_PUBLIC_KEY),
        clerkFrontendApi: env.CLERK_FRONTEND_API,
        cliClientId: env.CLERK_CLI_CLIENT_ID,
        desktopClientId: env.CLERK_DESKTOP_CLIENT_ID,
        tunnelBaseDomain: env.TUNNEL_BASE_DOMAIN,
        requireHttps: true,
        cleanupMode: cleanupMode(env.RELAY_TUNNEL_CLEANUP_MODE),
      },
      store: createStore(env.DB, now),
      identity: clerkIdentity({ frontendApi: env.CLERK_FRONTEND_API, clientIds: [env.CLERK_CLI_CLIENT_ID, env.CLERK_DESKTOP_CLIENT_ID] }),
      tunnels: cloudflareTunnels({ accountId: env.CLOUDFLARE_ACCOUNT_ID, zoneId: env.CLOUDFLARE_ZONE_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
      now,
      fetch: (input, init) => fetch(input, init),
    });
}

export default {
  fetch: (request: Request, env: Env) => relayFor(env).fetch(request),
  // The cron trigger in wrangler.toml runs the idle-tunnel sweep; its counts go to the Worker's logs.
  async scheduled(_controller: unknown, env: Env) {
    console.log(JSON.stringify({ sweep: await relayFor(env).sweep() }));
  },
};
