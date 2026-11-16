import { createServer } from "node:http";

// A stand-in for GitHub's Actions and releases API, for the fake server: owner/name has two runs queued, one
// holding a job for example-linux and one for example-docker, and one job for a hosted label. It
// answers with ETags like GitHub, so a repeated look is a 304. It also answers as a GitHub App
// installed on owner/name and owner/other, with three pull requests open on owner/name, to any token.
export async function startFakeGitHub(now: number) {
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
  const pull = (number: number, title: string, branch: string, opened: number, changed: number, draft = false) => ({ number, title, draft, user: { login: "someone" }, head: { ref: branch, sha: String(number % 10).repeat(40) }, base: { ref: "main" }, created_at: ago(opened), updated_at: ago(changed) });
  const replies: Record<string, unknown> = {
    "/app": { slug: "example-reviewer", name: "Example Reviewer" },
    "/app/installations?per_page=100": [{ id: 1 }],
    "/app/installations/1/access_tokens": { token: "not-a-real-installation-token", expires_at: new Date(now + 3_600_000).toISOString() },
    "/installation/repositories?per_page=100&page=1": { total_count: 2, repositories: [{ full_name: "owner/name" }, { full_name: "owner/other" }] },
    "/repos/owner/name/pulls?state=open&sort=updated&direction=desc&per_page=50": [
      pull(41, "The queue shows a job once its runner is gone", "fix/queue-gone-runner", 180, 12),
      pull(40, "Restart runners from About", "feat/restart-from-about", 1500, 95),
      pull(38, "Try a smaller image for lint", "experiment/lint-image", 4300, 2900, true),
    ],
    "/repos/owner/name/actions/runs?status=queued&per_page=20": runs,
    "/repos/owner/name/actions/runs/7/jobs?filter=latest&per_page=100": { jobs: [job("e2e", "example-linux", 6, 7), { ...job("lint", "ubuntu-24.04", 6, 7), labels: ["ubuntu-24.04"] }] },
    "/repos/owner/name/actions/runs/8/jobs?filter=latest&per_page=100": { jobs: [job("integration", "example-docker", 2, 8)] },
    // The fixtures' gh is 2.45.0, well behind; their runner is the newest.
    "/repos/cli/cli/releases/latest": { tag_name: "v2.83.0", published_at: new Date(now - 14 * 86_400_000).toISOString() },
    "/repos/cli/cli/releases/tags/v2.45.0": { tag_name: "v2.45.0", published_at: "2024-02-07T00:00:00Z" },
    "/repos/actions/runner/releases/latest": { tag_name: "v2.338.2", published_at: new Date(now - 25 * 86_400_000).toISOString() },
    "/repos/actions/runner/releases/tags/v2.338.2": { tag_name: "v2.338.2", published_at: new Date(now - 25 * 86_400_000).toISOString() },
  };
  const server = createServer((request, response) => {
    const path = request.url ?? "";
    const rate = { "x-ratelimit-remaining": "4900", "x-ratelimit-limit": "5000", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) };
    const reply = replies[path] ?? (path.includes("/actions/runs?") ? { workflow_runs: [] } : undefined);
    if (reply === undefined) return void response.writeHead(404, rate).end("{}");
    if (request.headers["if-none-match"] === `"${path}"`) return void response.writeHead(304, { ...rate, etag: `"${path}"` }).end();
    response.writeHead(200, { ...rate, etag: `"${path}"`, "content-type": "application/json" }).end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { apiBase: `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}` };
}
