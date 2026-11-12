import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ReproduceRefused, type Reproducer } from "./reproducer.ts";
import { listenForReproduce, socketPath } from "./socket.ts";

// A reproducer whose start is refused and whose stop is a plain answer, to see the socket's side.
const reproducer: Reproducer = {
  start: async () => {
    throw new ReproduceRefused("A reproduce is already running on this install. Stop it first.");
  },
  exec: async () => {
    throw new ReproduceRefused("No reproduce has that id.");
  },
  stop: async () => ({ stopped: true }),
  check: async () => {},
  begin: async () => () => {},
  end: async () => {},
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

test("the socket is the owner's alone, and answers each request with one JSON line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  try {
    const server = await listenForReproduce(dir, reproducer);
    const path = socketPath(dir);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, "reproduce"))).mode & 0o777, 0o700);
    assert.deepEqual(await ask(path, JSON.stringify({ op: "stop", id: "0a1b2c3d" })), { ok: true, stopped: true });
    const refused = await ask(path, JSON.stringify({ op: "start", repo: "owner/name", commit: "a".repeat(40), kind: "linux", network: "on" }));
    assert.deepEqual(refused, { ok: false, error: "A reproduce is already running on this install. Stop it first." });
    const invalid = (await ask(path, JSON.stringify({ op: "exec", id: "0a1b2c3d", command: "ls", timeoutSec: 601 }))) as { ok: boolean; error: string };
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /isn't valid/);
    assert.deepEqual(await ask(path, "not json"), { ok: false, error: "That request isn't JSON." });
    server.close();
    // An earlier up's socket is replaced.
    (await listenForReproduce(dir, reproducer)).close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("up refuses a socket directory others can open, and a file in the socket's place", async () => {
  const open = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  const planted = await mkdtemp(join(tmpdir(), "rbx-sock-"));
  try {
    await mkdir(join(open, "reproduce"), { mode: 0o755 });
    await chmod(join(open, "reproduce"), 0o755);
    await assert.rejects(listenForReproduce(open, reproducer), /open to other users/);
    await mkdir(join(planted, "reproduce"), { mode: 0o700 });
    await writeFile(socketPath(planted), "not a socket");
    await assert.rejects(listenForReproduce(planted, reproducer), /isn't a socket this user made/);
  } finally {
    await rm(open, { recursive: true, force: true });
    await rm(planted, { recursive: true, force: true });
  }
});
