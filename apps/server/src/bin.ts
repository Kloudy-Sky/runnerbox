#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ALL_SCOPES, AuthScope } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { stateDir } from "runnerbox/src/tracking/state-dir.ts";
import * as AuthStore from "./auth/AuthStore.ts";
import * as ServerPaths from "./config/ServerPaths.ts";
import * as EnvironmentIdentity from "./environment/EnvironmentIdentity.ts";
import { layerServer } from "./server.ts";

const USAGE = `Usage:
  runnerbox-server serve [--host <address>] [--port <n>] [--label <name>]
  runnerbox-server pair [--scopes <list>] [--json]

serve: answers the desktop app over HTTP and WebSocket. Binds 127.0.0.1:4517 by default; reach
  it from another machine over SSH rather than binding a public address.
pair: prints a one-time code, valid for 15 minutes, that pairs one client. --scopes is a
  comma-separated subset of ${ALL_SCOPES.join(",")} (default: all).

Reads what \`report\` and \`up\` recorded under XDG_STATE_HOME/runnerbox, as they do.`;

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const decodeScopes = Schema.decodeUnknownSync(Schema.Array(AuthScope));

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "4517" },
      label: { type: "string" },
      scopes: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || rest.length > 0 || (command !== "serve" && command !== "pair")) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
    return;
  }
  const dir = stateDir();
  const paths = ServerPaths.layer(dir);

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

main();
