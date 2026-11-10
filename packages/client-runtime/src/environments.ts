import { AuthScope } from "@runnerbox/contracts";
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
export const Route = Schema.Union([DirectRoute, SshRoute]);
export type SshRoute = typeof SshRoute.Type;
export type Route = typeof Route.Type;

export const SavedEnvironment = Schema.Struct({
  environmentId: Schema.String,
  label: Schema.String,
  route: Route,
  token: Schema.String,
  scopes: Schema.Array(AuthScope),
  pairedAt: Schema.String,
});
export type SavedEnvironment = typeof SavedEnvironment.Type;

// What the host app provides. The desktop app keeps the catalog in its main process, with tokens
// encrypted, and opens SSH forwards. A plain browser keeps the catalog in local storage and has no
// SSH, so `ssh` is absent there.
export interface ClientPlatform {
  readonly catalog: {
    readonly list: () => Promise<ReadonlyArray<SavedEnvironment>>;
    readonly save: (environment: SavedEnvironment) => Promise<void>;
    readonly remove: (environmentId: string) => Promise<void>;
  };
  readonly ssh?: {
    // Forwards a local port to the route's server and returns the URL to use, reusing a live forward.
    readonly openTunnel: (route: SshRoute) => Promise<{ readonly baseUrl: string }>;
    readonly closeTunnel: (route: SshRoute) => Promise<void>;
    // Runs `<serverCommand> pair --json` over SSH, so pairing needs no code typed by hand.
    readonly fetchPairingCode: (route: SshRoute) => Promise<{ readonly code: string; readonly environmentId: string }>;
  };
}
