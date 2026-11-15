import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SUPERVISED_ENV } from "./protocol.ts";
import { Supervisor } from "./Supervisor.ts";

// A stand-in for runnerbox.js, written to a temporary directory.
const withServer = async (source: string, body: (file: string, dir: string) => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-supervisor-"));
  const file = join(dir, "runnerbox.js");
  await writeFile(file, source);
  try {
    await body(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const supervise = (file: string, stopGraceMs?: number) =>
  new Supervisor({ node: process.execPath, nodeArgs: [], file, args: ["serve", "--port", "1"], env: process.env, ...(stopGraceMs === undefined ? {} : { stopGraceMs }) });

test("the supervisor exits with its server's code, so the service manager's restart policy still applies", async () => {
  await withServer("process.exit(3);", async (file) => {
    assert.equal(await supervise(file).run(), 3);
  });
});

test("the server runs the same file with the same arguments, and knows it's supervised", async () => {
  await withServer(
    `require("node:fs").writeFileSync(require("node:path").join(__dirname, "seen.json"), JSON.stringify({ argv: process.argv.slice(2), context: process.env.${SUPERVISED_ENV} }));`,
    async (file, dir) => {
      assert.equal(await supervise(file).run(), 0);
      const seen = JSON.parse(await readFile(join(dir, "seen.json"), "utf8"));
      assert.deepEqual(seen.argv, ["serve", "--port", "1"]);
      assert.deepEqual(JSON.parse(seen.context), { protocol: 1, file, role: "active" });
    },
  );
});

test("a stop is passed to the server, which finishes on its own", async () => {
  await withServer(
    `process.on("SIGTERM", () => { require("node:fs").writeFileSync(require("node:path").join(__dirname, "stopped"), ""); process.exit(0); }); setInterval(() => {}, 1000); ${STARTED}`,
    async (file, dir) => {
      const supervisor = supervise(file);
      const exited = supervisor.run();
      await started(dir);
      supervisor.stop("SIGTERM");
      assert.equal(await exited, 0);
      await readFile(join(dir, "stopped"));
    },
  );
});

test("a server that ignores a stop is killed after the grace period", async () => {
  await withServer(`process.on("SIGTERM", () => {}); setInterval(() => {}, 1000); ${STARTED}`, async (file, dir) => {
    const supervisor = supervise(file, 200);
    const exited = supervisor.run();
    await started(dir);
    supervisor.stop("SIGTERM");
    assert.equal(await exited, 128 + 9);
  });
});

// Until a stand-in has written `started` beside itself, once its signal handler is in place.
const started = async (dir: string) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await readFile(join(dir, "started")).then(() => true, () => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The stand-in never started.");
};
const STARTED = `require("node:fs").writeFileSync(require("node:path").join(__dirname, "started"), "");`;

const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });

// To the supervisor alone, or to its whole process group as systemd's default stop and Ctrl-C in
// a terminal send it, so the server gets it twice.
for (const to of ["the supervisor", "the process group"] as const)
test(`runnerbox serve answers under its supervisor, and SIGTERM to ${to} stops both`, async () => {
  const home = await mkdtemp(join(tmpdir(), "runnerbox-supervised-"));
  const port = await freePort();
  const child = spawn(process.execPath, [new URL("../../../../../src/main.ts", import.meta.url).pathname, "serve", "--port", String(port)], {
    env: { ...process.env, XDG_STATE_HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes("runnerbox pair")) resolve();
      });
      child.once("exit", () => reject(new Error(`serve exited early:\n${output}`)));
    });
    // The startup lines can print before the listener is bound.
    let descriptor: { environmentId?: unknown } = {};
    for (let attempt = 0; attempt < 100 && descriptor.environmentId === undefined; attempt++) {
      descriptor = await fetch(`http://127.0.0.1:${port}/.well-known/runnerbox/environment`).then((response) => response.json(), () => ({}));
      if (descriptor.environmentId === undefined) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(typeof descriptor.environmentId, "string");
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    if (to === "the supervisor") child.kill("SIGTERM");
    else process.kill(-(child.pid ?? 0), "SIGTERM");
    // The server's own code for a stop, as when it ran without a supervisor.
    assert.equal(await exited, 130);
    // The server went with it: nothing is left listening.
    await assert.rejects(fetch(`http://127.0.0.1:${port}/.well-known/runnerbox/environment`));
  } finally {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {
      // Already gone.
    }
    await rm(home, { recursive: true, force: true });
  }
});

test("serve --help under the supervisor prints and exits", async () => {
  const child = spawn(process.execPath, [new URL("../../../../../src/main.ts", import.meta.url).pathname, "serve", "--help"], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assert.equal(code, 0);
  assert.match(output, /runnerbox serve/);
});
