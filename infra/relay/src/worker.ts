import { clerkIdentity } from "./identity.ts";
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
};

// Wrangler stores PEM secrets with escaped newlines.
const pem = (value: string) => value.replace(/\\n/g, "\n");

export default {
  fetch(request: Request, env: Env) {
    const now = () => Date.now();
    const relay = createRelay({
      config: {
        issuer: env.RELAY_ISSUER,
        signingPrivateKey: pem(env.RELAY_SIGNING_PRIVATE_KEY),
        signingPublicKey: pem(env.RELAY_SIGNING_PUBLIC_KEY),
        clerkFrontendApi: env.CLERK_FRONTEND_API,
        cliClientId: env.CLERK_CLI_CLIENT_ID,
        desktopClientId: env.CLERK_DESKTOP_CLIENT_ID,
        tunnelBaseDomain: env.TUNNEL_BASE_DOMAIN,
        requireHttps: true,
      },
      store: createStore(env.DB, now),
      identity: clerkIdentity({ frontendApi: env.CLERK_FRONTEND_API }),
      tunnels: cloudflareTunnels({ accountId: env.CLOUDFLARE_ACCOUNT_ID, zoneId: env.CLOUDFLARE_ZONE_ID, apiToken: env.CLOUDFLARE_API_TOKEN }),
      now,
      fetch: (input, init) => fetch(input, init),
    });
    return relay.fetch(request);
  },
};
