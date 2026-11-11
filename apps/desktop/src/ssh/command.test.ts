import assert from "node:assert/strict";
import { test } from "node:test";
import type { SshRoute } from "@runnerbox/client-runtime";
import { pairArgs, parsePairOutput, SshRouteError, tunnelArgs } from "./command.ts";

const route: SshRoute = { kind: "ssh", host: "user@example", sshPort: 2222, remotePort: 4517, serverCommand: "node /opt/runnerbox/runnerbox.js" };

test("a tunnel forwards only loopback to loopback, never prompts, and ends the options before the host", () => {
  assert.deepEqual(tunnelArgs(route, 50123), [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-p", "2222",
    "-N", "-o", "ExitOnForwardFailure=yes",
    "-L", "127.0.0.1:50123:127.0.0.1:4517",
    "--", "user@example",
  ]);
  assert.ok(!tunnelArgs({ ...route, sshPort: null }, 50123).includes("-p"), "no port means ssh's own config decides");
});

test("fetching a code runs the server's pair command there as one argument", () => {
  assert.deepEqual(pairArgs(route).slice(-3), ["--", "user@example", "node /opt/runnerbox/runnerbox.js pair --json"]);
});

test("a host or command that could smuggle options or a second command is refused", () => {
  for (const host of ["-oProxyCommand=sh", "example host", "example;id", ""]) {
    assert.throws(() => tunnelArgs({ ...route, host }, 50123), SshRouteError, host);
  }
  assert.throws(() => tunnelArgs({ ...route, remotePort: 70000 }, 50123), SshRouteError);
  assert.throws(() => pairArgs({ ...route, serverCommand: "node runnerbox.js\nrm -rf ~" }), SshRouteError);
});

test("the pairing code is read from the last JSON line, past any login banner", () => {
  const output = `Welcome to example\n{"code":"AAAAA-BBBBB-CCCCC-DDDDD","scopes":["history:read"],"expiresAt":"2026-01-01T00:15:00.000Z","environmentId":"b3e65e27"}\n`;
  assert.deepEqual(parsePairOutput(output), { code: "AAAAA-BBBBB-CCCCC-DDDDD", environmentId: "b3e65e27" });
  assert.throws(() => parsePairOutput("node: cannot find module runnerbox.js\n"), SshRouteError);
});
