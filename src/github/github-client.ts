import { execFileSync } from "node:child_process";
import { type } from "arktype";

export const GITHUB_API = "https://api.github.com";
// owner/name. Dots are allowed in names like .github, but not `..`, which would change the API path.
export const REPO_NAME = /^[\w-]+\/(?!\.\.?$)[\w.-]+$/;
const PAGE_SIZE = 100;
// GitHub stops returning results past this many when a run list is filtered.
const FILTERED_RESULT_CAP = 1000;
// The rate limit belongs to the user, not to this tool, and that user's other tools may mint
// runners. Stopping early means a large sync can't leave them unable to start jobs.
const REQUESTS_TO_LEAVE = 1000;
// Actions tokens have a much smaller hourly limit, where a fixed floor would stop every sync.
const SHARE_TO_LEAVE = 0.2;

const WorkflowRun = type({ id: "number", run_attempt: "number" });
const RunPage = type({ total_count: "number", workflow_runs: WorkflowRun.array() });

const Step = type({
  name: "string",
  conclusion: "string | null",
  "started_at?": "string | null",
  "completed_at?": "string | null",
});

const Job = type({
  id: "number",
  run_id: "number",
  run_attempt: "number",
  name: "string",
  conclusion: "string | null",
  created_at: "string",
  started_at: "string | null",
  completed_at: "string | null",
  runner_name: "string | null",
  labels: "string[]",
  head_branch: "string | null",
  "head_sha?": "string",
  workflow_name: "string | null",
  "steps?": Step.array(),
});
const JobPage = type({ jobs: Job.array() });

export type WorkflowRun = typeof WorkflowRun.infer;
export type GitHubJob = typeof Job.infer;

export function githubHeaders(token: string) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// Prefers GITHUB_TOKEN, then the local gh login. The token only needs read access to Actions.
export function resolveToken() {
  const fromEnv = process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;

  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No GitHub token found. Set GITHUB_TOKEN or run `gh auth login`.");
  }
}

export function createGitHubClient(token: string) {
  async function get(path: string, params: Record<string, string | number>) {
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    );
    const response = await fetch(`${GITHUB_API}/${path}?${query}`, { headers: githubHeaders(token) });
    const remaining = Number(response.headers.get("x-ratelimit-remaining") ?? Infinity);
    const limit = Number(response.headers.get("x-ratelimit-limit") ?? Infinity);
    if (remaining < Math.min(REQUESTS_TO_LEAVE, limit * SHARE_TO_LEAVE)) {
      const reset = new Date(Number(response.headers.get("x-ratelimit-reset")) * 1000).toISOString();
      throw new Error(
        `Stopped with ${remaining} GitHub requests left, to keep some for other tools. Run this again after ${reset} to continue.`,
      );
    }
    if (response.ok) return response.json();
    throw new Error(`GitHub returned ${response.status} for ${path}`);
  }

  return {
    // Yields the completed runs created on one UTC day (YYYY-MM-DD).
    async *runs(repo: string, day: string) {
      for (let page = 1; ; page++) {
        const body = parse(
          RunPage,
          await get(`repos/${repo}/actions/runs`, {
            created: day,
            status: "completed",
            exclude_pull_requests: "true",
            per_page: PAGE_SIZE,
            page,
          }),
        );
        if (page === 1 && body.total_count > FILTERED_RESULT_CAP) {
          console.error(`Warning: ${day} has ${body.total_count} runs. GitHub only returns ${FILTERED_RESULT_CAP}.`);
        }
        yield* body.workflow_runs;
        if (body.workflow_runs.length < PAGE_SIZE) return;
      }
    },

    // Returns the jobs from every attempt of a run, so reruns stay visible.
    async jobs(repo: string, runId: number) {
      const jobs: GitHubJob[] = [];
      for (let page = 1; ; page++) {
        const body = parse(
          JobPage,
          await get(`repos/${repo}/actions/runs/${runId}/jobs`, {
            filter: "all",
            per_page: PAGE_SIZE,
            page,
          }),
        );
        jobs.push(...body.jobs);
        if (body.jobs.length < PAGE_SIZE) return jobs;
      }
    },
  };
}

function parse<T>(schema: (data: unknown) => T | type.errors, data: unknown): T {
  const parsed = schema(data);
  if (parsed instanceof type.errors) throw new Error(`Unexpected GitHub response: ${parsed.summary}`);
  return parsed;
}
