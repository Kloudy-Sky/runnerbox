import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ListeningPorts from "../config/ListeningPorts.ts";
import { layerReady } from "../server.ts";
import * as Supervision from "./Supervision.ts";
import { standIn } from "./supervisor/testing/standIn.ts";
import { readRecord, updatePaths } from "./supervisor/updateFiles.ts";

const HARNESS = new URL("./supervisor/testing/harness.ts", import.meta.url).pathname;
const SERVER = new URL("./supervisor/testing/supervisedServer.ts", import.meta.url).pathname;

async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Written whole, then renamed, so the server never reads half of it.
const ask = async (dir: string, request: { version: string; path: string; sha256: string }) => {
  await writeFile(join(dir, "request.tmp"), JSON.stringify(request));
  await rename(join(dir, "request.tmp"), join(dir, "request.json"));
};

test("the real supervisor and the server's Supervision layer agree on the wire", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-supervision-"));
  const file = join(dir, "runnerbox.js");
  // runnerbox.js here is the server's real half of the line, on 0.3.1.
  await writeFile(file, `import ${JSON.stringify(SERVER)};\n`);
  const staged = updatePaths(file).staged("0.3.2");
  const source = standIn("0.3.2");
  const supervisor = spawn(process.execPath, [HARNESS, file, "-", "serve"], { stdio: ["ignore", "inherit", "inherit"], detached: true });
  try {
    // Refused first, a downgrade, so the server's own version is what the supervisor compared.
    await ask(dir, { version: "0.3.0", path: updatePaths(file).staged("0.3.0"), sha256: "0".repeat(64) });
    const refused = await until("an answer", () => readFile(join(dir, "answer.json"), "utf8").then(JSON.parse, () => null));
    assert.match(refused.refused, /0\.3\.0 isn't newer than 0\.3\.1/);
  } finally {
    process.kill(-(supervisor.pid ?? 0), "SIGKILL");
  }
  // Again, from the start, for the real thing.
  await rm(join(dir, "answer.json"));
  await rm(join(dir, "ready"));
  const again = spawn(process.execPath, [HARNESS, file, "-", "serve"], { stdio: ["ignore", "inherit", "inherit"], detached: true });
  try {
    // Downloaded once the server is running, as a real one does: a supervisor's start clears
    // downloads an earlier update left.
    await until("the server to be ready", () => readFile(join(dir, "ready")).then(() => true, () => null));
    await mkdir(updatePaths(file).dir, { recursive: true });
    await writeFile(staged, source);
    await ask(dir, { version: "0.3.2", path: staged, sha256: createHash("sha256").update(source).digest("hex") });
    const accepted = await until("an answer", () => readFile(join(dir, "answer.json"), "utf8").then(JSON.parse, () => null));
    assert.match(accepted.accepted, /^[0-9a-f]{16}$/);
    const done = await until("the update to settle", async () => {
      const record = await readRecord(updatePaths(file).record);
      return record?.status === "committed" ? record : null;
    });
    assert.equal(done.id, accepted.accepted);
    assert.equal(await readFile(file, "utf8"), source);
  } finally {
    process.kill(-(again.pid ?? 0), "SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});

test("a server says it's ready only once every listener it opens is bound", async () => {
  const readied: string[] = [];
  const supervision = Layer.succeed(Supervision.Supervision, Supervision.Supervision.of({ context: null, ready: (version) => Effect.sync(() => void readied.push(version)), requestUpdate: () => Effect.die("unused") }));
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ports = yield* ListeningPorts.ListeningPorts;
        yield* Layer.build(layerReady(true));
        yield* Deferred.succeed(ports.bound.local, undefined);
        yield* Effect.sleep("50 millis");
        // The loopback listener alone, as a server whose tunnel listener couldn't bind.
        assert.deepEqual(readied, []);
        yield* Deferred.succeed(ports.bound.tunnel, undefined);
        yield* Effect.sleep("50 millis");
        assert.equal(readied.length, 1);
      }).pipe(Effect.provide(Layer.merge(ListeningPorts.layer({ port: 1, tunnelPort: 2 }), supervision))),
    ),
  );
});
