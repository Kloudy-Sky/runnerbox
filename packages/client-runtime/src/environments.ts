import { AuthScope, type ConnectResponse, type LinkedEnvironment } from "@runnerbox/contracts";
import * as Schema from "effect/Schema";

// How to reach an environment. A direct route is a URL the client can open. An SSH route asks the
// desktop app to forward the server's loopback port from another machine first.
export const DirectRoute = Schema.Struct({ kind: Schema.Literal("direct"), url: Schema.String });
export const SshRoute = Schema.Struct({
  kind: Schema.Literal("ssh"),
  // A Host from ~/.ssh/config, or user@host.
  host: Schema.String,
  sshPort: Schema.NullOr(Schema.Int),
  remotePort: Schema.Int,
  // How to run the server's CLI on that machine, for fetching a pairing code over SSH.
  serverCommand: Schema.String,
});
// Through a Runnerbox Connect relay: the relay asks the environment for a one-time credential
// bound to a key this client makes, and the client then talks to the environment's tunnel.
export const ConnectRoute = Schema.Struct({ kind: Schema.Literal("connect"), relayUrl: Schema.String });
export const Route = Schema.Union([DirectRoute, SshRoute, ConnectRoute]);
export type SshRoute = typeof SshRoute.Type;
export type Route = typeof Route.Type;

// `routes` is tried in order until one connects. `token` is the session from pairing over a
// direct or SSH route; a Connect route buys a fresh, key-bound session each time instead.
export const SavedEnvironment = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  routes: Schema.Array(Route),
  token: Schema.NullOr(Schema.String),
  scopes: Schema.Array(AuthScope),
  pairedAt: Schema.String,
});
export type SavedEnvironment = typeof SavedEnvironment.Type;

// Saved before routes became a list, with one `route`. Read and moved to the new shape.
const LegacySavedEnvironment = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  route: Schema.Union([DirectRoute, SshRoute]),
  token: Schema.String,
  scopes: Schema.Array(AuthScope),
  pairedAt: Schema.String,
});
const decodeSaved = Schema.decodeUnknownOption(Schema.Union([SavedEnvironment, LegacySavedEnvironment]));

export function readSavedEnvironments(stored: unknown): SavedEnvironment[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((entry) => {
    const decoded = decodeSaved(entry);
    if (decoded._tag === "None") return [];
    const value = decoded.value;
    if ("routes" in value) return [value];
    const { route, ...rest } = value;
    return [{ ...rest, routes: [route] }];
  });
}

// What the host app provides. The desktop app keeps the catalog in its main process, with tokens
// encrypted, and opens SSH forwards. A plain browser keeps the catalog in local storage and has no
// SSH, so `ssh` is absent there.
export interface ClientPlatform {
  readonly catalog: {
    readonly list: () => Promise<ReadonlyArray<SavedEnvironment>>;
    readonly save: (environment: SavedEnvironment) => Promise<void>;
    readonly remove: (environmentId: string) => Promise<void>;
  };
  // Runnerbox Connect, through the desktop app's main process, which holds the Clerk sign-in.
  readonly connect?: {
    readonly status: () => Promise<{ readonly relayUrl: string | null; readonly signedIn: boolean }>;
    readonly signIn: (relayUrl: string) => Promise<void>;
    readonly signOut: () => Promise<void>;
    readonly environments: () => Promise<ReadonlyArray<LinkedEnvironment>>;
    // Asks the relay for a one-time credential bound to the key with this thumbprint.
    readonly requestCredential: (environmentId: string, clientProofKeyThumbprint: string) => Promise<ConnectResponse>;
  };
  readonly ssh?: {
    // Forwards a local port to the route's server and returns the URL to use, reusing a live forward.
    readonly openTunnel: (route: SshRoute) => Promise<{ readonly baseUrl: string }>;
    readonly closeTunnel: (route: SshRoute) => Promise<void>;
    // Runs `<serverCommand> pair --json` over SSH, so pairing needs no code typed by hand.
    readonly fetchPairingCode: (route: SshRoute) => Promise<{ readonly code: string; readonly environmentId: string }>;
  };
}
