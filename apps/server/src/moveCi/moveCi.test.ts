import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import type { AuthScope } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { TEST_APP, USER_TOKEN, writeGitHubSession } from "../testing/githubSession.ts";
import { startTestServer } from "../testing/testServer.ts";

const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };
const CI = "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make\n";
const base64 = (text: string) => Buffer.from(text).toString("base64");

// A stand-in for GitHub with the App on owner/name, which has one workflow, a file beside it that
// isn't one, and a name that would leave the folder, and on owner/other, which has no workflows.
// `asked` is every path requested, as GitHub would see them.
async function fakeGitHub() {
  const asked: string[] = [];
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
    return path in replies ? json(200, replies[path]) : json(404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { apiBase: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`, asked, close: () => new Promise((resolve) => server.close(resolve)) };
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
