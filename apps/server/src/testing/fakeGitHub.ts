import { createServer } from "node:http";

// A stand-in for GitHub's Actions and releases API, for the fake server: owner/name has two runs queued, one
// holding a job for example-linux and one for example-docker, and one job for a hosted label. It
// answers with ETags like GitHub, so a repeated look is a 304. It also answers as GitHub with the
// App installed on owner/name and owner/other, with three pull requests open on owner/name, the
// second with a run going, to any token, and signs a server in as octocat a few seconds after it
// asks for a code.
// `code` is the first pull request's real commits and diff, from reviewFixture.ts, so it can be reviewed.
export async function startFakeGitHub(now: number, code?: { readonly baseSha: string; readonly headSha: string; readonly diff: string }) {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const runs = { workflow_runs: [{ id: 7, created_at: ago(6) }, { id: 8, created_at: ago(2) }] };
  let jobs = 0;
  const job = (name: string, label: string, minutes: number, run: number) => ({
    name,
    workflow_name: "ci",
    status: "queued",
    labels: ["self-hosted", label],
    created_at: ago(minutes),
    html_url: `https://github.com/owner/name/actions/runs/${run}/job/${(jobs += 1)}`,
  });
  const pull = (number: number, title: string, branch: string, opened: number, changed: number, draft = false) => ({ number, title, draft, user: { login: "someone" }, head: { ref: branch, sha: String(number % 10).repeat(40), repo: { full_name: "owner/name" } }, base: { ref: "main" }, created_at: ago(opened), updated_at: ago(changed) });
  const first = { ...pull(41, "The queue shows a job once its runner is gone", "fix/queue-gone-runner", 180, 12), ...(code ? { head: { ref: "fix/queue-gone-runner", sha: code.headSha, repo: { full_name: "owner/name" } } } : {}) };
  const replies: Record<string, unknown> = {
    "/user": { login: "octocat" },
    "/user/installations?per_page=100": { installations: [{ id: 1, repository_selection: "selected", account: { login: "owner" }, html_url: "https://github.com/settings/installations/1" }] },
    "/user/installations/1/repositories?per_page=100&page=1": { total_count: 2, repositories: [{ full_name: "owner/name" }, { full_name: "owner/other" }] },
    "/repos/owner/name/pulls?state=open&sort=updated&direction=desc&per_page=50": [
      first,
      pull(40, "Restart runners from About", "feat/restart-from-about", 1500, 95),
      pull(38, "Try a smaller image for lint", "experiment/lint-image", 4300, 2900, true),
    ],
    ...(code
      ? { "/repos/owner/name/pulls/41": { ...first, state: "open", body: "A job stayed assigned to a runner that had gone.\n\nNow it waits again.", base: { ref: "main", sha: code.baseSha }, additions: 7, deletions: 3, changed_files: 1 } }
      : {}),
    "/repos/owner/name/actions/runs?status=queued&per_page=20": runs,
    "/repos/owner/name/actions/runs/7/jobs?filter=latest&per_page=100": { jobs: [job("e2e", "example-linux", 6, 7), { ...job("lint", "ubuntu-24.04", 6, 7), labels: ["ubuntu-24.04"] }] },
    "/repos/owner/name/actions/runs/8/jobs?filter=latest&per_page=100": { jobs: [job("integration", "example-docker", 2, 8)] },
    // Pull request 40's checks: one passed on a hosted runner, one still running.
    [`/repos/owner/name/actions/runs?head_sha=${"0".repeat(40)}&per_page=100`]: { workflow_runs: [{ id: 9, run_attempt: 1, status: "in_progress" }] },
    "/repos/owner/name/actions/runs/9/jobs?filter=latest&per_page=100": {
      jobs: [
        { run_id: 9, run_attempt: 1, workflow_name: "ci", name: "lint", status: "completed", conclusion: "success", started_at: ago(94), completed_at: ago(93) },
        { run_id: 9, run_attempt: 1, workflow_name: "ci", name: "e2e", status: "in_progress", conclusion: null, started_at: ago(4), completed_at: null },
      ],
    },
    // The fixtures' gh is 2.45.0, well behind; their runner is the newest.
    "/repos/cli/cli/releases/latest": { tag_name: "v2.83.0", published_at: new Date(now - 14 * 86_400_000).toISOString() },
    "/repos/cli/cli/releases/tags/v2.45.0": { tag_name: "v2.45.0", published_at: "2024-02-07T00:00:00Z" },
    "/repos/actions/runner/releases/latest": { tag_name: "v2.338.2", published_at: new Date(now - 25 * 86_400_000).toISOString() },
    "/repos/actions/runner/releases/tags/v2.338.2": { tag_name: "v2.338.2", published_at: new Date(now - 25 * 86_400_000).toISOString() },
  };
  // The device flow: a code that's approved on the second time it's asked about.
  let polls = 0;
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const json = (body: unknown) => void response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (path === "/login/device/code") {
      polls = 0;
      return json({ device_code: "not-a-real-device-code", user_code: "WDJB-MJHT", verification_uri: `${base()}/login/device`, expires_in: 900, interval: 2 });
    }
    if (path === "/login/oauth/access_token") return json((polls += 1) < 2 ? { error: "authorization_pending" } : { access_token: "not-a-real-user-token", expires_in: 28_800, refresh_token: "not-a-real-refresh-token", refresh_token_expires_in: 15_897_600 });
    const rate = { "x-ratelimit-remaining": "4900", "x-ratelimit-limit": "5000", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) };
    if (code && path === `/repos/owner/name/compare/${code.baseSha}...${code.headSha}`) return void response.writeHead(200, { ...rate, "content-type": "text/plain" }).end(code.diff);
    const reply = replies[path] ?? (path.includes("/actions/runs?") ? { workflow_runs: [] } : undefined);
    if (reply === undefined) return void response.writeHead(404, rate).end("{}");
    if (request.headers["if-none-match"] === `"${path}"`) return void response.writeHead(304, { ...rate, etag: `"${path}"` }).end();
    response.writeHead(200, { ...rate, etag: `"${path}"`, "content-type": "application/json" }).end(JSON.stringify(reply));
  });
  const base = () => {
    const address = server.address();
    return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  };
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { apiBase: base() };
}
