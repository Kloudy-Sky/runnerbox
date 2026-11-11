import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerPaths from "../config/ServerPaths.ts";
import * as AuthStore from "./AuthStore.ts";
import { sha256 } from "./secrets.ts";

test("a Connect session expires and is pruned, while a paired app's session lasts until revoked", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-auth-"));
  try {
    const session = (id: string, token: string, extra: object) => ({
      id, tokenHash: sha256(token), label: id, audience: "client", scopes: ["history:read"], createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", ...extra,
    });
    await mkdir(join(stateDir, ".server"), { recursive: true });
    await writeFile(
      join(stateDir, ".server", "auth.json"),
      JSON.stringify({ v: 1, codes: [], sessions: [session("old-connect", "rbx_old", { proofKeyThumbprint: "key", expiresAt: "2026-01-01T01:00:00.000Z" }), session("app", "rbx_app", {})] }),
    );
    const layer = AuthStore.layer.pipe(Layer.provideMerge(ServerPaths.layer(stateDir)), Layer.provideMerge(NodeServices.layer));
    const withStore = <A, E>(use: (store: AuthStore.AuthStore["Service"]) => Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.gen(function* () {
        return yield* use(yield* AuthStore.AuthStore);
      }).pipe(Effect.provide(layer)));

    assert.equal(await withStore((store) => store.authenticate("rbx_old", "client", "key")), undefined);
    assert.equal((await withStore((store) => store.authenticate("rbx_app", "client")))?.id, "app");

    // Any write prunes what's expired. A new Connect session gets an expiry of its own.
    const { code } = await withStore((store) => store.createPairingCode(["history:read"], { proofKeyThumbprint: "key-2" }));
    await withStore((store) => store.pair({ code, label: "connect", proofKeyThumbprint: "key-2" }));
    const stored = JSON.parse(await readFile(join(stateDir, ".server", "auth.json"), "utf8")) as { sessions: { id: string; expiresAt?: string; label: string }[] };
    assert.deepEqual(stored.sessions.map((entry) => entry.label), ["app", "connect"]);
    const expiresIn = Date.parse(stored.sessions[1]!.expiresAt!) - Date.now();
    assert.ok(expiresIn > 55 * 60_000 && expiresIn <= 60 * 60_000, `expires in ${expiresIn} ms`);
    assert.equal(stored.sessions[0]!.expiresAt, undefined);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
