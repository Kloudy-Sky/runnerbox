import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import { ALL_SCOPES, type AuthScope } from "@runnerbox/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import * as GitHub from "../github/GitHub.ts";
import * as QueueConfig from "../runners/QueueConfig.ts";
import * as RunnerState from "../runners/RunnerState.ts";
import { TEST_APP, USER_TOKEN, writeGitHubSession } from "../testing/githubSession.ts";
import { startTestServer } from "../testing/testServer.ts";
import * as MoveCi from "./MoveCi.ts";

const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };
const CI = "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n";
const base64 = (text: string) => Buffer.from(text).toString("base64");

// A stand-in for GitHub with the App on owner/name, which has one workflow, a file beside it that
// isn't one, and a name that would leave the folder, and on owner/other, which has no workflows.
// `asked` is every path requested, as GitHub would see them.
async function fakeGitHub() {
  const asked: string[] = [];
  // `wait` answers owner/name's listing as GitHub does when it wants ten minutes' rest.
  const script = { wait: false };
  const replies: Record<string, unknown> = {
    "/user/installations?per_page=100": { installations: [{ id: 11, repository_selection: "selected", account: { login: "owner" } }] },
    "/user/installations/11/repositories?per_page=100&page=1": { total_count: 2, repositories: [{ full_name: "owner/name" }, { full_name: "owner/other" }] },
    "/repos/owner/name/contents/.github/workflows": [
      { type: "file", path: ".github/workflows/ci.yml" },
      { type: "file", path: ".github/workflows/README.md" },
      { type: "file", path: ".github/workflows/../../secrets.yml" },
    ],
    "/repos/owner/name/contents/.github/workflows/ci.yml": { encoding: "base64", content: base64(CI) },
  };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    asked.push(path);
    const json = (status: number, body: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.headers.authorization !== `Bearer ${USER_TOKEN}`) return json(401, {});
    if (script.wait && path === "/repos/owner/name/contents/.github/workflows") return void response.writeHead(403, { "retry-after": "600" }).end("{}");
    return path in replies ? json(200, replies[path]) : json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { apiBase: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, asked, script, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("Move CI reads only the workflows on each installed repository, drafts the patch, and asks GitHub once a minute", async () => {
  const github = await fakeGitHub();
  const server = await startTestServer({ prepare: writeGitHubSession, queue: { apiBase: github.apiBase, app: TEST_APP, reportEnvPath: "/nonexistent/report.env", timing: TIMING } });
  const status = async (scopes: ReadonlyArray<AuthScope>) => {
    const { code } = await server.createPairingCode(scopes);
    const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
    return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(client["moveCi.status"]()))));
  };
  try {
    const view = await status(["history:read"]);
    assert.ok(Exit.isSuccess(view));
    // owner/other has no workflows, so it has nothing to move and isn't listed.
    assert.deepEqual(view.value.repos.map(({ repo, jobs, problem }) => ({ repo, jobs, problem })), [
      { repo: "owner/name", jobs: [{ workflow: ".github/workflows/ci.yml", job: "build", runsOn: "ubuntu-latest", state: "patched", variable: "LINUX_RUNNER", docker: null }], problem: null },
    ]);
    assert.match(view.value.repos[0]?.patch ?? "", /^\+    runs-on: \$\{\{ vars\.LINUX_RUNNER \|\| 'ubuntu-latest' \}\}$/m);
    assert.ok(!JSON.stringify(view.value).includes(USER_TOKEN));
    // Nothing outside the workflows folder is asked for, and no other kind of file in it.
    assert.deepEqual(github.asked.filter((path) => path.startsWith("/repos/")).toSorted(), ["/repos/owner/name/contents/.github/workflows", "/repos/owner/other/contents/.github/workflows", "/repos/owner/name/contents/.github/workflows/ci.yml"].toSorted());

    const before = github.asked.length;
    const again = await status(["history:read"]);
    assert.ok(Exit.isSuccess(again) && again.value.repos.length === 1);
    assert.equal(github.asked.length, before);
  } finally {
    await Promise.all([server.close(), github.close()]);
  }
});

test("Move CI keeps to the owner's budget: a repository without workflows waits ten minutes, and a wait GitHub asks for is kept", async () => {
  const github = await fakeGitHub();
  const reach = { app: TEST_APP, token: USER_TOKEN, installations: [], repos: ["owner/name", "owner/other"], grants: new Map(), problem: null };
  const signedIn = Layer.succeed(GitHub.GitHub, GitHub.GitHub.of({ reach: Effect.succeed(reach), status: () => Effect.die("unused"), signIn: () => Effect.die("unused"), cancelSignIn: () => Effect.die("unused"), signOut: () => Effect.die("unused") }));
  const queue = QueueConfig.layerTest({ apiBase: github.apiBase, reportEnvPath: "/nonexistent/report.env", timing: TIMING });
  const noRunners = Layer.succeed(RunnerState.RunnerState, RunnerState.RunnerState.of({ current: Effect.succeed([]), changes: Stream.empty }));
  const context = await Effect.runPromise(Layer.build(Layer.mergeAll(MoveCi.layer.pipe(Layer.provide(Layer.mergeAll(signedIn, queue, noRunners))), TestClock.layer())).pipe(Effect.scoped));
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect.pipe(Effect.provide(context)));
  const status = () => run(Context.get(context, MoveCi.MoveCi).status({ switch: false }));
  const later = (minutes: number) => run(TestClock.adjust(`${minutes} minutes`));
  const listings = (repo: string) => github.asked.filter((path) => path === `/repos/${repo}/contents/.github/workflows`).length;
  try {
    // A wait is in GitHub's time, which is the server's clock outside a test.
    await run(TestClock.setTime(Date.now()));
    assert.equal((await status()).repos.length, 1);

    github.script.wait = true;
    await later(1);
    const waited = await status();
    // The rows from before stand in, and the view says why.
    assert.equal(waited.repos[0]?.patch?.includes("vars.LINUX_RUNNER"), true);
    assert.match(waited.problem ?? "", /asked Runnerbox to wait/);
    const asked = github.asked.length;
    await later(2);
    await status();
    assert.equal(github.asked.length, asked);
    // owner/other said it has no workflows, and a 404 has no ETag to make asking again free.
    assert.equal(listings("owner/other"), 1);

    github.script.wait = false;
    await later(8);
    const after = await status();
    assert.equal(after.problem, null);
    assert.equal(listings("owner/name"), 3);
    assert.equal(listings("owner/other"), 2);
  } finally {
    await github.close();
  }
});

const MOVING = "jobs:\n  build:\n    runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}\n  e2e:\n    runs-on: ${{ vars.LINUX_RUNNER || 'ubuntu-24.04' }}\n    services:\n      db:\n        image: postgres\n";

// A stand-in for GitHub's variables. The App's install on owner has accepted Variables, on owner/name,
// owner/third, where the organization sets LINUX_RUNNER, and owner/fourth, whose organization's
// variables GitHub fails to list; the one on example, with example/tools, hasn't, so GitHub refuses
// its variables. Every repository's jobs read LINUX_RUNNER, and e2e needs Docker. `writes` is every
// write, as GitHub would see it, and `rejectToken` answers them as GitHub does a revoked token.
async function fakeVariables() {
  const writes: string[] = [];
  const script = { rejectToken: false };
  const own = new Map<string, Map<string, string>>([["owner/name", new Map()], ["owner/third", new Map()], ["owner/fourth", new Map()]]);
  const org = new Map([["owner/third", new Map([["LINUX_RUNNER", "elsewhere"]])]]);
  const listed = (values: ReadonlyMap<string, string> | undefined) => ({ total_count: values?.size ?? 0, variables: [...(values ?? new Map())].map(([name, value]) => ({ name, value })) });
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const send = (status: number, body?: unknown) => void response.writeHead(status, { "content-type": "application/json" }).end(body === undefined ? undefined : JSON.stringify(body));
    if (request.headers.authorization !== `Bearer ${USER_TOKEN}`) return send(401, {});
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      if (path === "/user/installations?per_page=100")
        return send(200, {
          installations: [
            { id: 11, repository_selection: "selected", account: { login: "owner" }, html_url: "https://github.com/settings/installations/11", permissions: { contents: "read", variables: "write" } },
            { id: 12, repository_selection: "selected", account: { login: "example" }, html_url: "https://github.com/organizations/example/settings/installations/12", permissions: { contents: "read" } },
          ],
        });
      if (path === "/user/installations/11/repositories?per_page=100&page=1") return send(200, { total_count: 3, repositories: [{ full_name: "owner/fourth" }, { full_name: "owner/name" }, { full_name: "owner/third" }] });
      if (path === "/user/installations/12/repositories?per_page=100&page=1") return send(200, { total_count: 1, repositories: [{ full_name: "example/tools" }] });
      const match = /^\/repos\/([\w-]+\/[\w-]+)\/(.+)$/.exec(path);
      const repo = match?.[1] ?? "";
      const rest = match?.[2] ?? "";
      if (rest === "contents/.github/workflows") return send(200, [{ type: "file", path: ".github/workflows/ci.yml" }]);
      if (rest === "contents/.github/workflows/ci.yml") return send(200, { encoding: "base64", content: base64(MOVING) });
      const values = own.get(repo);
      if (rest.startsWith("actions/organization-variables?")) return repo === "owner/fourth" ? send(502, {}) : send(200, listed(org.get(repo)));
      if (request.method === "GET" && rest.startsWith("actions/variables?")) return values ? send(200, listed(values)) : send(403, {});
      if (request.method === "GET") return send(404, {});
      writes.push(`${request.method} ${path} ${text}`.trim());
      if (script.rejectToken) return send(401, {});
      if (values === undefined) return send(403, {});
      const name = /^actions\/variables\/(\w+)$/.exec(rest)?.[1];
      if (request.method === "POST" && rest === "actions/variables") {
        const body = JSON.parse(text) as { name: string; value: string };
        if (values.has(body.name)) return send(409, {});
        values.set(body.name, body.value);
        return send(201, {});
      }
      if (name === undefined || !values.has(name)) return send(404, {});
      if (request.method === "PATCH") values.set(name, (JSON.parse(text) as { value: string }).value);
      else values.delete(name);
      return send(204);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { apiBase: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, writes, script, own, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("the switch writes only a runner this machine has that every job can run on, and says why a repository can't be switched", async () => {
  const github = await fakeVariables();
  const server = await startTestServer({ prepare: writeGitHubSession, queue: { apiBase: github.apiBase, app: TEST_APP, reportEnvPath: "/nonexistent/report.env", timing: TIMING } });
  const session = async <A, E>(scopes: ReadonlyArray<AuthScope>, use: (client: Effect.Success<ReturnType<typeof openSession>>["client"]) => Effect.Effect<A, E>) => {
    const { code } = await server.createPairingCode(scopes);
    const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "app"));
    return Effect.runPromise(Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Effect.exit(use(client)))));
  };
  const set = (repo: string, label: string | null, variable: "LINUX_RUNNER" | "MAC_RUNNER" = "LINUX_RUNNER") => session(ALL_SCOPES, (client) => client["moveCi.setRunner"]({ repo, variable, label }));
  const refused = (exit: Exit.Exit<unknown, unknown>, why: RegExp) => {
    assert.ok(Exit.isFailure(exit));
    assert.match(Cause.pretty(exit.cause), why);
  };
  try {
    const view = await session(ALL_SCOPES, (client) => client["moveCi.status"]());
    assert.ok(Exit.isSuccess(view));
    assert.equal(view.value.canSwitch, true);
    assert.deepEqual(view.value.runners, [{ label: "example-docker", docker: true, mac: false }, { label: "example-linux", docker: false, mac: false }]);
    assert.deepEqual(view.value.repos.map(({ repo, switch: state, variables, approveUrl }) => ({ repo, state, variables, approveUrl })), [
      { repo: "example/tools", state: "approve", variables: [], approveUrl: "https://github.com/organizations/example/settings/installations/12" },
      { repo: "owner/fourth", state: "unread", variables: [], approveUrl: null },
      { repo: "owner/name", state: "ready", variables: [{ name: "LINUX_RUNNER", value: null, org: null }], approveUrl: null },
      { repo: "owner/third", state: "ready", variables: [{ name: "LINUX_RUNNER", value: null, org: "elsewhere" }], approveUrl: null },
    ]);

    // Refused before anything is written: e2e needs Docker, the label isn't here, no job reads MAC_RUNNER,
    // with the repository's deleted, owner/third's jobs would still follow the organization's, and
    // owner/fourth's organization might set one too, since GitHub didn't say.
    refused(await set("owner/name", "example-linux"), /needs Docker/);
    refused(await set("owner/name", "somewhere-else"), /isn't a runner on this machine/);
    refused(await set("owner/name", "example-docker", "MAC_RUNNER"), /No job on that repository reads that variable/);
    refused(await set("owner/third", null), /organization sets that variable/);
    refused(await set("owner/fourth", null), /didn't say whether the organization sets that variable/);
    refused(await session(["history:read"], (client) => client["moveCi.setRunner"]({ repo: "owner/name", variable: "LINUX_RUNNER", label: "example-docker" })), /access:write/);
    assert.deepEqual(github.writes, []);

    // The first move creates the variable, the next changes it, and GitHub deletes it.
    const moved = await set("owner/name", "example-docker");
    assert.ok(Exit.isSuccess(moved));
    assert.deepEqual(moved.value.repos.find(({ repo }) => repo === "owner/name")?.variables, [{ name: "LINUX_RUNNER", value: "example-docker", org: null }]);
    assert.ok(Exit.isSuccess(await set("owner/name", "example-docker")));
    // A token GitHub won't take isn't a variable already deleted: the row still says where the jobs run.
    github.script.rejectToken = true;
    refused(await set("owner/name", null), /GitHub refused/);
    const still = await session(ALL_SCOPES, (client) => client["moveCi.status"]());
    assert.ok(Exit.isSuccess(still));
    assert.equal(still.value.repos.find(({ repo }) => repo === "owner/name")?.variables[0]?.value, "example-docker");
    github.script.rejectToken = false;
    const back = await set("owner/name", null);
    assert.ok(Exit.isSuccess(back));
    assert.equal(back.value.repos.find(({ repo }) => repo === "owner/name")?.variables[0]?.value, null);
    // GitHub has the last word on an install that hasn't accepted the permission.
    refused(await set("example/tools", "example-docker"), /GitHub refused/);
    assert.deepEqual(github.writes, [
      'PATCH /repos/owner/name/actions/variables/LINUX_RUNNER {"name":"LINUX_RUNNER","value":"example-docker"}',
      'POST /repos/owner/name/actions/variables {"name":"LINUX_RUNNER","value":"example-docker"}',
      'PATCH /repos/owner/name/actions/variables/LINUX_RUNNER {"name":"LINUX_RUNNER","value":"example-docker"}',
      "DELETE /repos/owner/name/actions/variables/LINUX_RUNNER",
      "DELETE /repos/owner/name/actions/variables/LINUX_RUNNER",
      'PATCH /repos/example/tools/actions/variables/LINUX_RUNNER {"name":"LINUX_RUNNER","value":"example-docker"}',
    ]);
    assert.ok(!JSON.stringify(moved.value).includes(USER_TOKEN));

    const reader = await session(["history:read"], (client) => client["moveCi.status"]());
    assert.ok(Exit.isSuccess(reader) && reader.value.canSwitch === false);
  } finally {
    await Promise.all([server.close(), github.close()]);
  }
});
