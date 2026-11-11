import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { clerkEndpoints, deviceAuthorize, loopbackAuthorize } from "@runnerbox/connect/oauth";
import { relayClient } from "@runnerbox/connect/relay";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ALL_SCOPES, AuthScope } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { stateDir } from "runnerbox/src/tracking/state-dir.ts";
import * as AuthStore from "./auth/AuthStore.ts";
import * as CloudLink from "./cloud/CloudLink.ts";
import * as ServerPaths from "./config/ServerPaths.ts";
import * as EnvironmentIdentity from "./environment/EnvironmentIdentity.ts";
import { SERVER_COMMANDS } from "./commandNames.ts";
import { layerServer } from "./server.ts";

const USAGE = `Usage:
  runnerbox serve [--host <address>] [--port <n>] [--label <name>]
  runnerbox pair [--scopes <list>] [--json]
  runnerbox mcp-token [--label <name>]
  runnerbox link --relay <url> [--device] [--tunnel-port <n>]
  runnerbox unlink
  runnerbox link-status

serve: answers the desktop app over HTTP and WebSocket. Binds 127.0.0.1:4517 by default; reach
  it from another machine over SSH rather than binding a public address.
pair: prints a one-time code, valid for 15 minutes, that pairs one client. --scopes is a
  comma-separated subset of ${ALL_SCOPES.join(",")} (default: all).
link: signs in to a Runnerbox Connect relay and links this environment, so your apps can reach
  it through a managed tunnel. Opens a browser, or with --device shows a code to approve from
  any browser, for a machine you reach over SSH. --tunnel-port is the loopback port serve opens
  for the tunnel alone (default: --port plus one); it serves Connect and nothing else.
unlink: removes the link and its tunnel. link-status: shows the link.
mcp-token: prints a token for an MCP client to send as a Bearer token to /mcp. It reads history
  and runner state, and works nowhere else. Revoke it from the app's access list.

Reads what \`report\` and \`up\` recorded under XDG_STATE_HOME/runnerbox, as they do.`;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const decodeScopes = Schema.decodeUnknownSync(Schema.Array(AuthScope));

// Runs one server command, given the arguments after `runnerbox`.
export function runServerCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4517" },
      label: { type: "string" },
      scopes: { type: "string" },
      json: { type: "boolean", default: false },
      relay: { type: "string" },
      device: { type: "boolean", default: false },
      "tunnel-port": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || rest.length > 0 || !SERVER_COMMANDS.includes(command ?? "")) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
    return;
  }
  const dir = stateDir();
  const paths = ServerPaths.layer(dir);

  if (command === "link" || command === "unlink" || command === "link-status") {
    const layer = CloudLink.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(values.label))),
      Layer.provideMerge(paths),
      Layer.provideMerge(NodeServices.layer),
    );
    const program = Effect.gen(function* () {
      const link = yield* CloudLink.CloudLink;
      if (command === "link-status") {
        const state = yield* link.state;
        return console.log(state ? `Linked to ${state.relayUrl} as ${state.httpBaseUrl}, since ${state.linkedAt}.` : "Not linked.");
      }
      if (command === "unlink") {
        yield* link.unlink;
        return console.log("Unlinked. The relay removed this environment's tunnel.");
      }
      const relayUrl = values.relay;
      if (!relayUrl || !/^https:\/\//.test(relayUrl)) return yield* Effect.fail(new Error("link needs --relay https://..."));
      const tunnelPort = Number(values["tunnel-port"] ?? Number(values.port) + 1);
      if (!Number.isInteger(tunnelPort) || tunnelPort < 1 || tunnelPort > 65535) return yield* Effect.fail(new Error("--tunnel-port must be a port number"));
      const accessToken = yield* Effect.tryPromise(() => signIn(relayUrl, values.device));
      const state = yield* link.link({ relayUrl, accessToken, tunnelPort });
      console.log(`Linked. Apps signed in to the same account can reach this environment at ${state.httpBaseUrl}.`);
      console.log("Restart serve to start the tunnel connector.");
    });
    return NodeRuntime.runMain(program.pipe(Effect.provide(layer)));
  }

  if (command === "mcp-token") {
    const label = values.label ?? "agent";
    const program = Effect.gen(function* () {
      const store = yield* AuthStore.AuthStore;
      const { token } = yield* store.mintMcpToken(label);
      console.log(`MCP token for "${label}", shown once:\n${token}\n`);
      console.log(`For Claude Code, with the server on its default address:`);
      console.log(`  claude mcp add --transport http runnerbox http://127.0.0.1:4517/mcp --header "Authorization: Bearer ${token}"`);
    });
    return NodeRuntime.runMain(program.pipe(Effect.provide(AuthStore.layer.pipe(Layer.provideMerge(paths), Layer.provideMerge(NodeServices.layer)))));
  }

  if (command === "pair") {
    const scopes = values.scopes === undefined ? ALL_SCOPES : decodeScopes(values.scopes.split(","));
    const program = Effect.gen(function* () {
      const store = yield* AuthStore.AuthStore;
      const { descriptor } = yield* EnvironmentIdentity.EnvironmentIdentity;
      const code = yield* store.createPairingCode(scopes);
      // The SSH route reads this line, so it stays one JSON object.
      if (values.json) return console.log(JSON.stringify({ ...code, environmentId: descriptor.environmentId }));
      console.log(`Pairing code: ${code.code}\nScopes: ${code.scopes.join(", ")}\nExpires: ${code.expiresAt}`);
    });
    const layer = Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(values.label)).pipe(
      Layer.provideMerge(paths),
      Layer.provideMerge(NodeServices.layer),
    );
    return NodeRuntime.runMain(program.pipe(Effect.provide(layer)));
  }

  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port ${values.port}`);
  if (!LOOPBACK.has(values.host)) {
    console.error(`Warning: listening on ${values.host}, not loopback. Anyone who can reach it can try to pair.`);
  }
  const announce = Effect.gen(function* () {
    const store = yield* AuthStore.AuthStore;
    const { descriptor } = yield* EnvironmentIdentity.EnvironmentIdentity;
    const code = yield* store.createPairingCode(ALL_SCOPES);
    console.log(`runnerbox server for ${descriptor.label} (${descriptor.environmentId})`);
    console.log(`Listening on http://${values.host}:${port}, reading ${dir}`);
    console.log(`Pairing code: ${code.code} (expires ${code.expiresAt})`);
  });
  const server = layerServer({ host: values.host, port, stateDir: dir, ...(values.label ? { label: values.label } : {}) });
  const startup = Layer.effectDiscard(announce).pipe(
    Layer.provide(Layer.mergeAll(AuthStore.layer, EnvironmentIdentity.layer(values.label)).pipe(Layer.provideMerge(paths), Layer.provideMerge(NodeServices.layer))),
  );
  NodeRuntime.runMain(Layer.launch(Layer.merge(server, startup)));
}

// Signs in to the relay's Clerk app as the CLI's public OAuth client, and returns an access token.
async function signIn(relayUrl: string, device: boolean) {
  const config = await relayClient(relayUrl).config();
  const endpoints = clerkEndpoints(config.clerkFrontendApi);
  const tokens = device
    ? await deviceAuthorize({
        endpoints,
        clientId: config.cliClientId,
        onCode: ({ userCode, verificationUri }) => console.log(`Open ${verificationUri} in any browser and enter ${userCode}.`),
      })
    : await loopbackAuthorize({
        endpoints,
        clientId: config.cliClientId,
        openBrowser: (url) => {
          console.log(`Opening a browser to sign in. If it doesn't open, visit:\n${url}`);
          const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
          spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
        },
      });
  return tokens.accessToken;
}
