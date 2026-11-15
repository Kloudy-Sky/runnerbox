#!/usr/bin/env node
import { SUPERVISED_ENV } from "../apps/server/src/update/supervisor/protocol.ts";

// `serve` starts under a supervisor that loads only Node's own modules, and runs this file again
// as the server; everything else is the CLI. Neither branch is loaded until it's picked.
if (process.argv[2] === "serve" && process.env[SUPERVISED_ENV] === undefined) {
  await import("../apps/server/src/update/supervisor/main.ts");
} else {
  // The supervisor's channel mustn't keep a short command, such as `serve --help`, running.
  process.channel?.unref();
  await import("./cli.ts");
}
