import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope, type GitHubStatus } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TEST_APP, USER_TOKEN, writeGitHubSession } from "../testing/githubSession.ts";
import { startTestServer } from "../testing/testServer.ts";

const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };
const REFRESHED_TOKEN = "not-a-real-refreshed-token";

// A stand-in for GitHub's sign-in and API. `answer` is what it says when asked whether the code was
// approved, and `forms` is every form posted to it, as GitHub would see them.
async function fakeGitHub() {
  const script: { answer: "approve" | "deny" | "wait"; refresh: "renew" | "refuse" } = { answer: "approve", refresh: "renew" };
  const forms: Array<Record<string, string>> = [];
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.method === "POST") {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(text));
        forms.push(form);
        if (path === "/login/device/code") return json(200, { device_code: "not-a-real-device-code", user_code: "WDJB-MJHT", verification_uri: `${base()}/login/device`, expires_in: 900, interval: 0.02 });
        if (path !== "/login/oauth/access_token") return json(404, {});
        if (form.grant_type === "refresh_token") return json(200, script.refresh === "renew" ? { access_token: REFRESHED_TOKEN, expires_in: 28_800, refresh_token: "not-a-real-next-refresh-token", refresh_token_expires_in: 15_897_600 } : { error: "incorrect_client_credentials" });
        if (script.answer === "wait") return json(200, { error: "authorization_pending" });
        return json(200, script.answer === "approve" ? { access_token: USER_TOKEN, expires_in: 28_800, refresh_token: "not-a-real-refresh-token", refresh_token_expires_in: 15_897_600 } : { error: "access_denied" });
      });
      return;
    }
    if (request.headers.authorization !== `Bearer ${USER_TOKEN}` && request.headers.authorization !== `Bearer ${REFRESHED_TOKEN}`) return json(401, {});
    if (path === "/user") return json(200, { login: "octocat" });
    if (path.startsWith("/user/installations?"))
      return json(200, {
        installations: [
          { id: 11, repository_selection: "selected", account: { login: "owner" }, html_url: "https://github.com/settings/installations/11" },
          { id: 12, repository_selection: "all", account: { login: "example" }, html_url: "https://elsewhere.example.com/installations/12" },
        ],
      });
    if (path.startsWith("/user/installations/11/repositories?")) return json(200, { total_count: 2, repositories: [{ full_name: "owner/name" }, { full_name: "owner/other" }] });
    if (path.startsWith("/user/installations/12/repositories?")) return json(200, { total_count: 1, repositories: [{ full_name: "example/tools" }] });
    return json(404, {});
  });
  const base = () => {
    const address = server.address();
    return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { base: base(), script, forms, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function start(options: { readonly prepare?: (stateDir: string) => Promise<void>; readonly app?: boolean } = {}) {
  const github = await fakeGitHub();
  const server = await startTestServer({ ...(options.prepare ? { prepare: options.prepare } : {}), queue: { apiBase: github.base, loginBase: github.base, ...(options.app === false ? {} : { app: TEST_APP }), reportEnvPath: "/nonexistent/report.env", timing: TIMING } });
  const session = async <A, E>(scopes: ReadonlyArray<AuthScope>, use: (client: Effect.Success<ReturnType<typeof openSession>>["client"]) => Effect.Effect<A, E>) => {
    const { code } = await server.createPairingCode(scopes);
    const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
    return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(use(client)))));
  };
  // The status once it satisfies `settled`, asked the way a waiting settings page asks.
  const until = async (settled: (status: GitHubStatus) => boolean) => {
    for (let tries = 0; tries < 200; tries += 1) {
      const status = await session(ALL_SCOPES, (client) => client["github.status"]());
      if (Exit.isSuccess(status) && settled(status.value)) return status.value;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("The sign-in never settled.");
  };
  const file = join(server.stateDir, ".server", "github-session.json");
  return { github, server, session, until, file, close: () => Promise.all([server.close(), github.close()]) };
}

test("the owner signs in by approving a code, with no secret sent, and the token stays on the server", async () => {
  const { github, session, until, file, close } = await start();
  try {
    github.script.answer = "wait";
    const asked = await session(ALL_SCOPES, (client) => client["github.signIn"]());
    assert.ok(Exit.isSuccess(asked));
    assert.deepEqual([asked.value.account, asked.value.pending?.userCode, asked.value.pending?.verificationUri], [null, "WDJB-MJHT", `${github.base}/login/device`]);
    // The code signs the server in as whoever types it, so a session that can't sign in isn't shown it.
    const reader = await session(["history:read"], (client) => client["github.status"]());
    assert.ok(Exit.isSuccess(reader) && reader.value.pending === null && reader.value.canConfigure === false);

    github.script.answer = "approve";
    const signedIn = await until((status) => status.account !== null);
    assert.deepEqual([signedIn.account, signedIn.pending, signedIn.app], ["octocat", null, { slug: "example-app", name: "Example App" }]);
    // An installation's page is linked only when it's on GitHub's own site.
    assert.deepEqual(signedIn.installations, [
      { account: "example", repositories: null, manageUrl: null },
      { account: "owner", repositories: 2, manageUrl: "https://github.com/settings/installations/11" },
    ]);
    assert.ok(!JSON.stringify(signedIn).includes(USER_TOKEN));
    // Only the public client ID went to GitHub with the code: no secret exists to send.
    assert.ok(github.forms.length > 1 && github.forms.every((form) => form.client_id === TEST_APP.clientId && !("client_secret" in form)));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok((await readFile(file, "utf8")).includes(USER_TOKEN));

    const out = await session(ALL_SCOPES, (client) => client["github.signOut"]());
    assert.ok(Exit.isSuccess(out) && out.value.account === null && out.value.installations.length === 0);
    await assert.rejects(stat(file));
  } finally {
    await close();
  }
});

test("a client watching the sign-in sees the code, the account once it's approved, and the sign-out, each as it happens", async () => {
  const { github, session, close } = await start();
  try {
    github.script.answer = "wait";
    // All of it well inside the 30 seconds a watcher waits before asking on its own.
    const seen = await session(ALL_SCOPES, (client) =>
      Effect.gen(function* () {
        const listed = yield* Deferred.make<void>();
        const waiting = yield* Deferred.make<void>();
        const signedIn = yield* Deferred.make<void>();
        const watching = yield* client["github.subscribe"]().pipe(
          Stream.map((status) => (status.account !== null ? `signed in as ${status.account}` : status.pending !== null ? `code ${status.pending.userCode}` : "signed out")),
          Stream.changes,
          Stream.tap((said) => Deferred.succeed(said.startsWith("code") ? waiting : said.startsWith("signed in") ? signedIn : listed, undefined)),
          Stream.take(4),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(listed);
        yield* client["github.signIn"]();
        yield* Deferred.await(waiting);
        github.script.answer = "approve";
        yield* Deferred.await(signedIn);
        yield* client["github.signOut"]();
        return yield* Fiber.join(watching);
      }).pipe(Effect.timeout("5 seconds")),
    );
    assert.ok(Exit.isSuccess(seen));
    assert.deepEqual(seen.value, ["signed out", "code WDJB-MJHT", "signed in as octocat", "signed out"]);
  } finally {
    await close();
  }
});

test("a code the owner turns down signs nobody in, and a session that can only read can't start a sign-in", async () => {
  const { github, session, until, file, close } = await start();
  try {
    const refused = await session(["history:read", "runners:read"], (client) => client["github.signIn"]());
    assert.ok(Exit.isFailure(refused));
    assert.match(Cause.pretty(refused.cause), /access:write/);

    github.script.answer = "deny";
    await session(ALL_SCOPES, (client) => client["github.signIn"]());
    const denied = await until((status) => status.failure !== null);
    assert.deepEqual([denied.account, denied.pending, denied.failure], [null, null, "denied"]);
    await assert.rejects(stat(file));
  } finally {
    await close();
  }
});

test("a token near its end is renewed with the client ID alone, and a sign-in GitHub has ended signs the server out", async () => {
  const expired = (stateDir: string) => writeGitHubSession(stateDir, { accessToken: "not-a-real-expired-token", accessTokenExpiresAt: Date.now() - 1000, refreshToken: "not-a-real-refresh-token" });
  const renewed = await start({ prepare: expired });
  try {
    const status = await renewed.session(ALL_SCOPES, (client) => client["github.status"]());
    assert.ok(Exit.isSuccess(status) && status.value.account === "octocat" && status.value.installations.length === 2);
    assert.deepEqual(renewed.github.forms, [{ client_id: TEST_APP.clientId, grant_type: "refresh_token", refresh_token: "not-a-real-refresh-token" }]);
    const kept = await readFile(renewed.file, "utf8");
    assert.ok(kept.includes(REFRESHED_TOKEN) && kept.includes("not-a-real-next-refresh-token") && !kept.includes("not-a-real-expired-token"));
  } finally {
    await renewed.close();
  }
  const ended = await start({ prepare: expired });
  try {
    ended.github.script.refresh = "refuse";
    const status = await ended.until((each) => each.account === null);
    assert.deepEqual(status.installations, []);
    await assert.rejects(stat(ended.file));
  } finally {
    await ended.close();
  }
});

test("a server with no App to sign in through says so", async () => {
  const { session, close } = await start({ app: false });
  try {
    const status = await session(ALL_SCOPES, (client) => client["github.status"]());
    assert.ok(Exit.isSuccess(status) && status.value.app === null && status.value.account === null);
    const refused = await session(ALL_SCOPES, (client) => client["github.signIn"]());
    assert.ok(Exit.isFailure(refused));
    assert.match(Cause.pretty(refused.cause), /no GitHub App to sign in through/);
  } finally {
    await close();
  }
});
