import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { releaseRepository, serverIsBehind, restartCommand, serverUpdateCommand, staleInstalls, underwayLine } from "./serverUpdate.ts";

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

test("the line an update shows says each step in plain words", () => {
  assert.equal(underwayLine({ step: "downloading", version: "0.2.0", received: 4.1 * 1024 * 1024, total: 9.8 * 1024 * 1024 }, "example"), "Updating example to 0.2.0. Downloading, 4.1 of 9.8 MB.");
  assert.equal(underwayLine({ step: "checking", version: "0.2.0" }, "example"), "Updating example to 0.2.0. Checking it.");
  assert.equal(underwayLine({ step: "starting", version: "0.2.0", updateId: "0123456789abcdef" }, "example"), "Updating example to 0.2.0. Starting the new version.");
});

test("the runners still on the old version are those that started before the update finished", () => {
  const install = (name: string, startedAt: string, runsIn?: "container" | "host", stale = false) => ({
    install: name,
    pid: 1,
    startedAt,
    updatedAt: startedAt,
    stopping: false,
    stale,
    kinds: [{ name: "linux", label: "x", image: null, building: null, ...(runsIn ? { runsIn } : {}), slots: [] }],
  });
  const update = { id: "0123456789abcdef", from: "0.1.9", to: "0.2.0", status: "committed" as const, startedAt: "2026-11-14T10:00:00Z", finishedAt: "2026-11-14T10:01:00Z" };
  const installs = [install("ci", "2026-11-14T09:00:00Z", "container"), install("mac", "2026-11-14T09:00:00Z", "host"), install("old", "2026-11-14T09:00:00Z"), install("fresh", "2026-11-14T10:05:00Z"), install("gone", "2026-11-14T09:00:00Z", "container", true)];
  // An install whose state doesn't say where it runs, from an older build, is listed with the command.
  assert.deepEqual(staleInstalls(installs, update), [
    { install: "ci", host: false },
    { install: "mac", host: true },
    { install: "old", host: false },
  ]);
  assert.deepEqual(staleInstalls(installs, { ...update, status: "rolled-back" }), [], "a rollback left the file as it was");
  assert.deepEqual(staleInstalls(installs, null), []);
});

test("a restart command passes the install's name to systemctl as one argument, whatever it holds", () => {
  for (const install of ["ci", "owner/name; rm -rf ~", "it's $(whoami) `id`"]) {
    const command = restartCommand(install).replace(/^systemctl /, "printf '%s\\n' ");
    const printed = spawnSync("sh", ["-c", command], { encoding: "utf8" }).stdout;
    assert.equal(printed, `--user\nrestart\nrunnerbox@${install}\n`);
  }
});
