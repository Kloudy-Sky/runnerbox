import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { startTestServer } from "../testing/testServer.ts";
import { appJwt } from "./appJwt.ts";
import { pullsOf } from "./pullRequests.ts";

const rsa = () => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const APP = rsa();
const APP_ID = "4242";
const INSTALLATION_TOKEN = "not-a-real-installation-token";
const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };

const signedByApp = (authorization: string | undefined) => {
  const [header, claims, signature] = (authorization ?? "").replace(/^Bearer /, "").split(".");
  if (!header || !claims || !signature) return false;
  const { iss } = JSON.parse(Buffer.from(claims, "base64url").toString());
  return iss === APP_ID && createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(APP.publicKey, signature, "base64url");
};

// A stand-in for GitHub: an App installed once, on owner/name and owner/other. It takes the App's
// signed token for the App's own endpoints and the installation's token for the rest.
async function fakeGitHub() {
  const minted: unknown[] = [];
  // `installationsDown` answers 502 where the App's installations are listed, and `listed` counts those requests.
  // `pullsAsked` counts the requests for owner/name's open pull requests.
  const script = { installationsDown: false, listed: 0, pullsAsked: 0 };
  const pull = { number: 7, title: "Fix the\u0007 widget\nagain", draft: false, user: { login: "someone" }, head: { ref: "fix/widget", sha: "a".repeat(40) }, base: { ref: "main" }, created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const asApp = signedByApp(request.headers.authorization);
    const asInstallation = request.headers.authorization === `Bearer ${INSTALLATION_TOKEN}`;
    if (path === "/app") return asApp ? json(200, { slug: "example-reviewer", name: "Example Reviewer" }) : json(401, {});
    if (path.startsWith("/app/installations?")) {
      script.listed += 1;
      if (script.installationsDown) return json(502, {});
      return asApp ? json(200, [{ id: 11 }]) : json(401, {});
    }
    if (path === "/app/installations/11/access_tokens" && request.method === "POST") {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        minted.push(JSON.parse(text));
        return asApp ? json(201, { token: INSTALLATION_TOKEN, expires_at: new Date(Date.now() + 3_600_000).toISOString() }) : json(401, {});
      });
      return;
    }
    if (!asInstallation) return json(401, {});
    if (path.startsWith("/installation/repositories?")) return json(200, { total_count: 2, repositories: [{ full_name: "owner/name" }, { full_name: "owner/other" }] });
    if (path.startsWith("/repos/owner/name/pulls?")) {
      script.pullsAsked += 1;
      return json(200, [pull]);
    }
    return json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { apiBase: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, minted, script, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function start() {
  const github = await fakeGitHub();
  const server = await startTestServer({ queue: { apiBase: github.apiBase, reportEnvPath: "/nonexistent/report.env", timing: TIMING } });
  const session = async <A, E>(scopes: ReadonlyArray<AuthScope>, use: (client: Effect.Success<ReturnType<typeof openSession>>["client"]) => Effect.Effect<A, E>) => {
    const { code } = await server.createPairingCode(scopes);
    const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
    return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(use(client)))));
  };
  return { github, server, session, close: () => Promise.all([server.close(), github.close()]) };
}

test("the owner connects an App, turns a repository on and sees its open pull requests, and the key stays on the server", async () => {
  const { github, server, session, close } = await start();
  try {
    const connected = await session(ALL_SCOPES, (client) => client["reviews.connect"]({ appId: APP_ID, privateKey: APP.privateKey }));
    assert.ok(Exit.isSuccess(connected));
    assert.deepEqual(connected.value.app, { slug: "example-reviewer", name: "Example Reviewer" });
    assert.deepEqual(connected.value.repos, [{ repo: "owner/name", review: false }, { repo: "owner/other", review: false }]);
    // Nothing is read from a repository until the owner turns it on.
    assert.deepEqual(connected.value.pulls, []);
    assert.ok(!JSON.stringify(connected.value).includes("PRIVATE KEY"));

    const on = await session(ALL_SCOPES, (client) => client["reviews.setRepo"]({ repo: "owner/name", review: true }));
    assert.ok(Exit.isSuccess(on));
    assert.deepEqual(on.value.pulls, [{ repo: "owner/name", number: 7, title: "Fix the widget again", author: "someone", branch: "fix/widget", base: "main", headSha: "a".repeat(40), draft: false, openedAt: "2026-11-14T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z" }]);

    // However often clients ask, GitHub is asked for a repository's list once in 20 seconds.
    const again = await session(["history:read"], (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(again) && again.value.pulls.length === 1);
    assert.equal(github.script.pullsAsked, 1);

    // The token the server works with can only read pull requests, whatever the App was granted.
    assert.deepEqual(github.minted, [{ permissions: { pull_requests: "read" } }]);
    const file = join(server.stateDir, ".server", "github-app.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok((await readFile(file, "utf8")).includes("PRIVATE KEY"));

    const off = await session(ALL_SCOPES, (client) => client["reviews.disconnect"]());
    assert.ok(Exit.isSuccess(off) && off.value.app === null && off.value.pulls.length === 0);
    await assert.rejects(stat(file));
  } finally {
    await close();
  }
});

test("a key GitHub doesn't know is refused and not kept, and so is a repository the App isn't installed on", async () => {
  const { server, session, close } = await start();
  try {
    const wrong = await session(ALL_SCOPES, (client) => client["reviews.connect"]({ appId: APP_ID, privateKey: rsa().privateKey }));
    assert.ok(Exit.isFailure(wrong));
    assert.match(Cause.pretty(wrong.cause), /GitHub refused that App ID and key/);
    await assert.rejects(stat(join(server.stateDir, ".server", "github-app.json")));

    await session(ALL_SCOPES, (client) => client["reviews.connect"]({ appId: APP_ID, privateKey: APP.privateKey }));
    const elsewhere = await session(ALL_SCOPES, (client) => client["reviews.setRepo"]({ repo: "someone/else", review: true }));
    assert.ok(Exit.isFailure(elsewhere));
    assert.match(Cause.pretty(elsewhere.cause), /isn't installed on that repository/);
  } finally {
    await close();
  }
});

test("while GitHub can't say where the App is installed, it's asked once a minute at most, and a repository isn't called uninstalled", async () => {
  const { github, session, close } = await start();
  try {
    github.script.installationsDown = true;
    const connected = await session(ALL_SCOPES, (client) => client["reviews.connect"]({ appId: APP_ID, privateKey: APP.privateKey }));
    assert.ok(Exit.isSuccess(connected) && connected.value.repos.length === 0);
    assert.match(connected.value.problem ?? "", /Couldn't list where the App is installed/);
    const again = await session(["history:read", "runners:read"], (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(again) && again.value.problem !== null);
    const on = await session(ALL_SCOPES, (client) => client["reviews.setRepo"]({ repo: "owner/name", review: true }));
    assert.ok(Exit.isFailure(on));
    assert.match(Cause.pretty(on.cause), /couldn't get an answer from GitHub/);
    assert.equal(github.script.listed, 1);
  } finally {
    await close();
  }
});

test("a session that can only read sees pull requests but can't connect an App or turn a repository on", async () => {
  const { session, close } = await start();
  try {
    await session(ALL_SCOPES, (client) => client["reviews.connect"]({ appId: APP_ID, privateKey: APP.privateKey }));
    const read = await session(["history:read", "runners:read"], (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(read) && read.value.app?.slug === "example-reviewer" && read.value.canConfigure === false);
    const refused = await session(["history:read", "runners:read"], (client) => client["reviews.setRepo"]({ repo: "owner/name", review: true }));
    assert.ok(Exit.isFailure(refused));
    assert.match(Cause.pretty(refused.cause), /access:write/);
  } finally {
    await close();
  }
});

test("the App's token is signed by its key and lasts under GitHub's ten minutes", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const jwt = appJwt(APP_ID, APP.privateKey, now);
  assert.ok(jwt !== null && signedByApp(`Bearer ${jwt}`));
  const { iat, exp } = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString());
  assert.ok(exp - iat <= 600 && iat < now / 1000);
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256", publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  assert.equal(appJwt(APP_ID, ec.privateKey, now), null);
});

test("a reply that isn't a list of pull requests reads as unknown, not as none open", () => {
  assert.equal(pullsOf("owner/name", { message: "Not Found" }), null);
  assert.deepEqual(pullsOf("owner/name", []), []);
});
