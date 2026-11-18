import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as EnvironmentIdentity from "./EnvironmentIdentity.ts";

const start = (stateDir: string) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      return yield* EnvironmentIdentity.EnvironmentIdentity;
    }).pipe(Effect.provide(EnvironmentIdentity.layer("example").pipe(Layer.provideMerge(ServerPaths.layer(stateDir)), Layer.provideMerge(NodeServices.layer)))),
  );

test("files a crash left empty are replaced, and the key then survives restarts, but a broken key is never replaced", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-identity-"));
  const serverDir = join(stateDir, ".server");
  try {
    await mkdir(serverDir, { recursive: true });
    await writeFile(join(serverDir, "environment-id"), "");
    await writeFile(join(serverDir, "environment-key.json"), "");
    const first = await start(stateDir);
    assert.equal(first._tag, "Success");
    const second = await start(stateDir);
    assert.ok(first._tag === "Success" && second._tag === "Success");
    assert.equal(second.value.descriptor.publicKey, first.value.descriptor.publicKey);
    assert.equal(second.value.descriptor.environmentId, first.value.descriptor.environmentId);

    // A key with anything in it may be pinned, so a broken one stops the server instead.
    await writeFile(join(serverDir, "environment-key.json"), "{\"publicKey\":");
    assert.equal((await start(stateDir))._tag, "Failure");
    assert.equal(await readFile(join(serverDir, "environment-key.json"), "utf8"), "{\"publicKey\":");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("servers starting at once on a fresh machine all start, with one ID and one key", async () => {
  for (let round = 0; round < 30; round++) {
    const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-identity-"));
    try {
      const started = await Promise.all(Array.from({ length: 4 }, () => start(stateDir)));
      const identities = started.map((exit) => (exit._tag === "Success" ? exit.value.descriptor : null));
      assert.ok(identities.every((identity) => identity !== null), "every server started");
      assert.equal(new Set(identities.map((identity) => identity?.environmentId)).size, 1);
      assert.equal(new Set(identities.map((identity) => identity?.publicKey)).size, 1);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  }
});
