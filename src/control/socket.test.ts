import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Changes } from "../changes/changes.ts";
import { ReproduceRefused, type Reproducer } from "../reproduce/reproducer.ts";
import { controlSocketPath, legacyReproduceSocketPath, listenForControl } from "./socket.ts";

// A reproducer whose start is refused and whose stop is a plain answer, to see the socket's side.
const reproducer: Reproducer = {
  start: async () => {
    throw new ReproduceRefused("A reproduce is already running on this install. Stop it first.");
  },
  exec: async () => {
    throw new ReproduceRefused("No reproduce has that id.");
  },
  stop: async () => ({ stopped: true }),
  status: () => ({ running: false, reason: "This reproduce ended: it was idle for 5 minutes." }),
  check: async () => {},
  begin: async () => () => {},
  end: async () => {},
};

const changes: Changes = {
  describe: async () => ({ install: "example", fields: [{ path: "runners.linux.slots", value: 1, min: 1, max: 2, unit: "slots" }], pending: null }),
  apply: async (request) => ({ accepted: true, when: request.when }),
  check: async () => {},
  begin: () => {},
  close: async () => {},
};

const ask = (path: string, line: string) =>
  new Promise<unknown>((resolve, reject) => {
    const socket = connect(path, () => socket.end(`${line}\n`));
    let received = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (received += chunk));
    socket.on("end", () => resolve(JSON.parse(received)));
    socket.on("error", reject);
  });

const APPLY = { op: "apply", proposalId: "0123456789abcdef", hash: "a".repeat(64), approvedBy: { session: "s", label: "desktop" }, when: "idle", changes: [{ path: "runners.linux.slots", from: 1, to: 2 }] };

test("the control socket is the owner's alone, and answers each request with one JSON line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  try {
    const control = await listenForControl(dir, { reproducer, changes });
    const path = controlSocketPath(dir);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, "control"))).mode & 0o777, 0o700);
    assert.deepEqual(await ask(path, JSON.stringify({ op: "stop", id: "0a1b2c3d" })), { ok: true, stopped: true });
    assert.deepEqual(await ask(path, JSON.stringify({ op: "status", id: "0a1b2c3d" })), { ok: true, running: false, reason: "This reproduce ended: it was idle for 5 minutes." });
    const refused = await ask(path, JSON.stringify({ op: "start", repo: "owner/name", commit: "a".repeat(40), kind: "linux", network: "on" }));
    assert.deepEqual(refused, { ok: false, error: "A reproduce is already running on this install. Stop it first." });
    assert.deepEqual(await ask(path, JSON.stringify(APPLY)), { ok: true, accepted: true, when: "idle" });
    const invalid = (await ask(path, JSON.stringify({ ...APPLY, changes: [{ path: "tokenFile", from: "/a", to: "/b" }] }))) as { ok: boolean; error: string };
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /isn't valid/);
    assert.deepEqual(await ask(path, "not json"), { ok: false, error: "That request isn't JSON." });
    // An older `serve` still finds reproduce where it was, for one release.
    assert.deepEqual(await ask(legacyReproduceSocketPath(dir), JSON.stringify({ op: "stop", id: "0a1b2c3d" })), { ok: true, stopped: true });
    control.close();
    // An earlier up's socket is replaced.
    (await listenForControl(dir, { reproducer, changes })).close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a socket answers only what its config turned on", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  try {
    const control = await listenForControl(dir, { reproducer: null, changes });
    const path = controlSocketPath(dir);
    assert.deepEqual(await ask(path, JSON.stringify({ op: "stop", id: "0a1b2c3d" })), { ok: false, error: "This install has no reproduce block." });
    assert.equal((await ask(path, JSON.stringify({ op: "describe" })) as { ok: boolean }).ok, true);
    await assert.rejects(stat(legacyReproduceSocketPath(dir)), "no reproduce, no old reproduce socket");
    control.close();
    const reproduceOnly = await listenForControl(dir, { reproducer, changes: null });
    assert.deepEqual(await ask(path, JSON.stringify(APPLY)), { ok: false, error: 'This install doesn\'t take proposals: its config has no "changes": true.' });
    reproduceOnly.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("up refuses a socket directory others can open, and a file in the socket's place", async () => {
  const open = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  const planted = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  try {
    await mkdir(join(open, "control"), { mode: 0o755 });
    await chmod(join(open, "control"), 0o755);
    await assert.rejects(listenForControl(open, { reproducer, changes }), /open to other users/);
    await mkdir(join(planted, "control"), { mode: 0o700 });
    await writeFile(controlSocketPath(planted), "not a socket");
    await assert.rejects(listenForControl(planted, { reproducer, changes }), /isn't a socket this user made/);
  } finally {
    await rm(open, { recursive: true, force: true });
    await rm(planted, { recursive: true, force: true });
  }
});
