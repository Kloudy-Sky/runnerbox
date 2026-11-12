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

test("a socket that starts watching after its session was revoked still hears of it", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-auth-"));
  try {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* AuthStore.AuthStore;
        const { code } = yield* store.createPairingCode(["history:read"]);
        yield* store.pair({ code, label: "example" });
        const [session] = yield* store.list("");
        // The revoke lands between redeeming the ticket and the socket starting to watch.
        yield* store.revoke(session!.id);
        return yield* store.revoked(session!.id).pipe(Effect.as("closed"), Effect.timeoutOrElse({ duration: "2 seconds", orElse: () => Effect.succeed("left open") }));
      }).pipe(Effect.provide(AuthStore.layer.pipe(Layer.provideMerge(ServerPaths.layer(stateDir)), Layer.provideMerge(NodeServices.layer)))),
    );
    assert.equal(outcome, "closed");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("a full session paired before threads or reproduce gets them; narrow, MCP and Connect sessions don't, and the file stays as it was", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "runnerbox-auth-"));
  try {
    const full = ["history:read", "runners:read", "access:write"];
    const session = (id: string, extra: object) => ({
      id, tokenHash: sha256(`rbx_${id}`), label: id, audience: "client", scopes: full, createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: null, ...extra,
    });
    const sessions = [
      session("full", {}),
      // Paired with every scope after threads came, before reproduce did.
      session("threads", { scopes: [...full, "threads:operate"] }),
      session("narrow", { scopes: ["history:read", "runners:read"] }),
      session("agent", { audience: "mcp" }),
      // Connect never grants access:write; this checks the rule itself refuses a key-bound session.
      session("connect", { proofKeyThumbprint: "key", expiresAt: "2999-01-01T00:00:00.000Z" }),
    ];
    await mkdir(join(stateDir, ".server"), { recursive: true });
    await writeFile(join(stateDir, ".server", "auth.json"), JSON.stringify({ v: 1, codes: [], sessions }));
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* AuthStore.AuthStore;
        const scopesOf = (id: string, audience: "client" | "mcp", key?: string) => store.authenticate(`rbx_${id}`, audience, key).pipe(Effect.map((found) => found?.scopes));
        const fullSession = (yield* store.authenticate("rbx_full", "client"))!;
        return {
          full: fullSession.scopes,
          threads: yield* scopesOf("threads", "client"),
          narrow: yield* scopesOf("narrow", "client"),
          agent: yield* scopesOf("agent", "mcp"),
          connect: yield* scopesOf("connect", "client", "key"),
          listed: (yield* store.list("full")).find((entry) => entry.id === "full")?.scopes,
          // It can hand threads on, since it now holds them.
          delegated: (yield* store.delegatePairingCode(fullSession, ["history:read", "threads:operate"])).scopes,
          narrowDelegates: yield* Effect.flip(store.delegatePairingCode((yield* store.authenticate("rbx_narrow", "client"))!, ["threads:operate"])),
        };
      }).pipe(Effect.provide(AuthStore.layer.pipe(Layer.provideMerge(ServerPaths.layer(stateDir)), Layer.provideMerge(NodeServices.layer)))),
    );
    assert.deepEqual(outcome.full, [...full, "threads:operate", "threads:reproduce"]);
    assert.deepEqual(outcome.threads, [...full, "threads:operate", "threads:reproduce"]);
    assert.deepEqual(outcome.listed, [...full, "threads:operate", "threads:reproduce"]);
    assert.deepEqual(outcome.narrow, ["history:read", "runners:read"]);
    assert.deepEqual(outcome.agent, full);
    assert.deepEqual(outcome.connect, full);
    assert.deepEqual(outcome.delegated, ["history:read", "threads:operate"]);
    assert.equal(outcome.narrowDelegates._tag === "AccessError" && outcome.narrowDelegates.reason, "scope_not_held");
    const stored = JSON.parse(await readFile(join(stateDir, ".server", "auth.json"), "utf8")) as { sessions: { id: string; scopes: string[] }[] };
    assert.deepEqual(stored.sessions.find((entry) => entry.id === "full")?.scopes, full, "an older server reads the same scopes");
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});
