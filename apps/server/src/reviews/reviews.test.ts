import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { TEST_APP, USER_TOKEN, writeGitHubSession } from "../testing/githubSession.ts";
import { startTestServer } from "../testing/testServer.ts";
import { pullsOf } from "./pullRequests.ts";

const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };

// A stand-in for GitHub: the App installed once, on owner/name and owner/other, answering only the
// signed-in user's token.
async function fakeGitHub() {
  // `installationsDown` answers 502 where the installations are listed, and `listed` counts those requests.
  // `pullsAsked` counts the requests for owner/name's open pull requests.
  const script = { installationsDown: false, listed: 0, pullsAsked: 0 };
  const pull = { number: 7, title: "Fix the\u0007 widget\nagain", draft: false, user: { login: "someone" }, head: { ref: "fix/widget", sha: "a".repeat(40), repo: { full_name: "owner/name" } }, base: { ref: "main" }, created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-15T10:00:00Z" };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.headers.authorization !== `Bearer ${USER_TOKEN}`) return json(401, {});
    if (path.startsWith("/user/installations?")) {
      script.listed += 1;
      return script.installationsDown ? json(502, {}) : json(200, { installations: [{ id: 11, repository_selection: "selected", account: { login: "owner" } }] });
    }
    if (path.startsWith("/user/installations/11/repositories?")) return json(200, { total_count: 2, repositories: [{ full_name: "owner/name" }, { full_name: "owner/other" }] });
    if (path.startsWith("/repos/owner/name/pulls?")) {
      script.pullsAsked += 1;
      return json(200, [pull]);
    }
    return json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { apiBase: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, script, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function start(signedIn = true) {
  const github = await fakeGitHub();
  const server = await startTestServer({ ...(signedIn ? { prepare: writeGitHubSession } : {}), queue: { apiBase: github.apiBase, app: TEST_APP, reportEnvPath: "/nonexistent/report.env", timing: TIMING } });
  const session = async <A, E>(scopes: ReadonlyArray<AuthScope>, use: (client: Effect.Success<ReturnType<typeof openSession>>["client"]) => Effect.Effect<A, E>) => {
    const { code } = await server.createPairingCode(scopes);
    const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
    return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(use(client)))));
  };
  return { github, server, session, close: () => Promise.all([server.close(), github.close()]) };
}

test("a signed-in server lists the repositories the App is installed on, and reads pull requests only on the ones turned on", async () => {
  const { github, session, close } = await start();
  try {
    const listed = await session(ALL_SCOPES, (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(listed));
    assert.deepEqual(listed.value.app, { slug: "example-app", name: "Example App" });
    assert.deepEqual(listed.value.repos, [{ repo: "owner/name", review: false }, { repo: "owner/other", review: false }]);
    // Nothing is read from a repository until the owner turns it on.
    assert.deepEqual(listed.value.pulls, []);
    assert.ok(!JSON.stringify(listed.value).includes(USER_TOKEN));

    const on = await session(ALL_SCOPES, (client) => client["reviews.setRepo"]({ repo: "owner/name", review: true }));
    assert.ok(Exit.isSuccess(on));
    assert.deepEqual(on.value.pulls, [{ repo: "owner/name", number: 7, title: "Fix the widget again", author: "someone", branch: "fix/widget", base: "main", headSha: "a".repeat(40), draft: false, openedAt: "2026-11-14T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z", checks: [] }]);

    // However often clients ask, GitHub is asked for a repository's list once in 20 seconds.
    const again = await session(["history:read"], (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(again) && again.value.pulls.length === 1);
    assert.equal(github.script.pullsAsked, 1);
  } finally {
    await close();
  }
});

test("a repository the App isn't installed on can't be turned on, and none can while the server is signed out", async () => {
  const signedIn = await start();
  try {
    const elsewhere = await signedIn.session(ALL_SCOPES, (client) => client["reviews.setRepo"]({ repo: "someone/else", review: true }));
    assert.ok(Exit.isFailure(elsewhere));
    assert.match(Cause.pretty(elsewhere.cause), /isn't installed on that repository/);
  } finally {
    await signedIn.close();
  }
  const signedOut = await start(false);
  try {
    const view = await signedOut.session(ALL_SCOPES, (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(view) && view.value.app === null && view.value.repos.length === 0);
    const refused = await signedOut.session(ALL_SCOPES, (client) => client["reviews.setRepo"]({ repo: "owner/name", review: true }));
    assert.ok(Exit.isFailure(refused));
    assert.match(Cause.pretty(refused.cause), /isn't signed in to GitHub/);
    assert.equal(signedOut.github.script.listed, 0);
  } finally {
    await signedOut.close();
  }
});

test("while GitHub can't say where the App is installed, it's asked once a minute at most, and a repository isn't called uninstalled", async () => {
  const { github, session, close } = await start();
  try {
    github.script.installationsDown = true;
    const view = await session(ALL_SCOPES, (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(view) && view.value.repos.length === 0);
    assert.match(view.value.problem ?? "", /Couldn't list where the App is installed/);
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

test("a session that can only read sees pull requests but can't turn a repository on", async () => {
  const { session, close } = await start();
  try {
    const read = await session(["history:read", "runners:read"], (client) => client["reviews.status"]());
    assert.ok(Exit.isSuccess(read) && read.value.app?.slug === "example-app" && read.value.canConfigure === false);
    const refused = await session(["history:read", "runners:read"], (client) => client["reviews.setRepo"]({ repo: "owner/name", review: true }));
    assert.ok(Exit.isFailure(refused));
    assert.match(Cause.pretty(refused.cause), /access:write/);
  } finally {
    await close();
  }
});

test("a reply that isn't a list of pull requests reads as unknown, not as none open", () => {
  assert.equal(pullsOf("owner/name", { message: "Not Found" }), null);
  assert.deepEqual(pullsOf("owner/name", []), []);
});
