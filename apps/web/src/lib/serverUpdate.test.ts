import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { releaseRepository, serverIsBehind, serverUpdateCommand } from "./serverUpdate.ts";

test("a server is behind only when it's older than a released app", () => {
  assert.equal(serverIsBehind("0.2.1", "0.2.0"), true);
  assert.equal(serverIsBehind("0.2.1-nightly.20261113.42", "0.2.0"), true);
  assert.equal(serverIsBehind("0.2.1", "0.2.1-nightly.20261113.42"), true);
  assert.equal(serverIsBehind("0.2.1", "0.2.1"), false);
  assert.equal(serverIsBehind("0.2.0", "0.2.1"), false, "a newer server is the app's to catch up with");
  assert.equal(serverIsBehind("0.0.0", "0.0.0"), false, "an app from a checkout can't tell");
});

// Runs the command as the owner would paste it, with `curl` and `systemctl` standing in: curl
// writes what the release would serve, and systemctl records the restart.
async function runUpdate(served: { script: string; sha256Of: string }) {
  const home = await mkdtemp(join(tmpdir(), "rbx-update-"));
  try {
    const bin = join(home, "bin");
    await mkdir(join(home, "runnerbox"), { recursive: true });
    await mkdir(bin);
    await writeFile(join(home, "runnerbox", "runnerbox.js"), "old");
    const sha = createHash("sha256").update(served.sha256Of).digest("hex");
    await writeFile(join(bin, "curl"), `#!/bin/sh\nprintf '%s' '${served.script}' > runnerbox.js\nprintf '%s  runnerbox.js\\n' '${sha}' > runnerbox.js.sha256\necho "$@" > "$HOME/curl-args"\n`);
    await writeFile(join(bin, "systemctl"), `#!/bin/sh\necho "$@" > "$HOME/restarted"\n`);
    await chmod(join(bin, "curl"), 0o755);
    await chmod(join(bin, "systemctl"), 0o755);
    const ran = spawnSync("sh", ["-c", serverUpdateCommand("owner/name", "0.2.1")], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home }, encoding: "utf8" });
    const read = (path: string) => readFile(join(home, path), "utf8").catch(() => null);
    return { status: ran.status, installed: await read("runnerbox/runnerbox.js"), restarted: await read("restarted"), curlArgs: await read("curl-args") };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("the command installs this app's release only after its sha256 checks out, then restarts the server", async () => {
  const good = await runUpdate({ script: "new", sha256Of: "new" });
  assert.deepEqual([good.status, good.installed, good.restarted?.trim()], [0, "new", "--user restart runnerbox-serve"]);
  assert.equal(good.curlArgs?.trim(), "-fsSL -O https://github.com/owner/name/releases/download/v0.2.1/runnerbox.js -O https://github.com/owner/name/releases/download/v0.2.1/runnerbox.js.sha256");
});

test("a download that doesn't match its sha256 leaves the old file and doesn't restart", async () => {
  const bad = await runUpdate({ script: "tampered", sha256Of: "new" });
  assert.notEqual(bad.status, 0);
  assert.deepEqual([bad.installed, bad.restarted], ["old", null]);
});

test("the command names only the repository this build was released from", () => {
  assert.equal(releaseRepository("owner/name"), "owner/name");
  assert.equal(releaseRepository(""), null);
  assert.equal(releaseRepository(undefined), null);
  assert.equal(releaseRepository("owner/name; rm -rf ~"), null);
  assert.throws(() => serverUpdateCommand("owner", "0.2.1"), /owner\/name/);
});
