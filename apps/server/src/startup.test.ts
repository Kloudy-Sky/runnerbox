import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

test("serve under a service manager prints and stores no pairing code, so none lands in its log", async () => {
  const home = await mkdtemp(join(tmpdir(), "runnerbox-startup-"));
  // Piped stdout, as under systemd: not a terminal.
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../../src/cli.ts", import.meta.url)), "serve", "--port", String(await freePort())], {
    env: { ...process.env, XDG_STATE_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let output = "";
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        // Whichever comes last: the pointer to `pair`, or a code.
        if (/runnerbox pair|Pairing code:/.test(output)) resolve();
      });
      child.once("exit", () => reject(new Error(`serve exited early:\n${output}`)));
    });
    assert.doesNotMatch(output, /Pairing code:/);
    const auth = await readFile(join(home, "runnerbox", ".server", "auth.json"), "utf8").catch(() => "");
    assert.ok(!auth.includes("codeHash"), "no code was minted");
  } finally {
    child.kill();
    await rm(home, { recursive: true, force: true });
  }
});
