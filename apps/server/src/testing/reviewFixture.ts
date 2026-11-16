import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A small git repository standing in for owner/name on GitHub's git host, with one branch a pull
// request would carry. `gitBase` is what a test server fetches from instead of github.com.

const QUEUE = `export type Job = { readonly id: number; readonly runner: string | null };

// Jobs waiting for a runner, oldest first.
export function waiting(jobs: ReadonlyArray<Job>) {
  return jobs.filter((job) => job.runner === null);
}
`;
const QUEUE_CHANGED = `export type Job = { readonly id: number; readonly runner: string | null };

// Jobs waiting for a runner, oldest first. A job whose runner has gone waits again.
export function waiting(jobs: ReadonlyArray<Job>, gone: ReadonlyArray<string>) {
  return jobs.filter((job) => job.runner === null || gone.includes(job.runner));
}

export function label(job: Job) {
  return job.runner.toUpperCase();
}
`;

export function makeReviewFixture(root: string) {
  const repo = join(root, "owner", "name.git");
  mkdirSync(join(repo, "src"), { recursive: true });
  const git = (...args: ReadonlyArray<string>) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Someone", GIT_AUTHOR_EMAIL: "someone@example.com", GIT_COMMITTER_NAME: "Someone", GIT_COMMITTER_EMAIL: "someone@example.com" },
    }).trim();
  git("init", "--quiet", "--initial-branch=main", ".");
  // A commit is asked for by its ID, as GitHub allows.
  git("config", "uploadpack.allowAnySHA1InWant", "true");
  writeFileSync(join(repo, "src", "queue.ts"), QUEUE);
  writeFileSync(join(repo, "AGENTS.md"), "# example\n\n- Every exported function says what it returns.\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "The queue lists waiting jobs");
  const baseSha = git("rev-parse", "HEAD");
  git("switch", "--quiet", "-c", "fix/queue-gone-runner");
  writeFileSync(join(repo, "src", "queue.ts"), QUEUE_CHANGED);
  git("commit", "--quiet", "-am", "A job whose runner is gone waits again");
  const headSha = git("rev-parse", "HEAD");
  return { gitBase: root, baseSha, headSha, diff: `${git("diff", `${baseSha}...${headSha}`)}\n` };
}

// What a scripted reviewer does with it: reads the changed file, looks for callers, and hands in one finding.
export const REVIEW_SCRIPT = [
  { tool: "read_file", input: { path: "src/queue.ts" } },
  { tool: "search_code", input: { pattern: "waiting\\(", glob: "src/**" } },
  { tool: "list_files", input: {} },
  {
    tool: "submit_review",
    input: {
      score: 3,
      impact: "medium",
      reach: "Reaches every list of waiting jobs and the new job label.",
      verdict: "Fix the label for a job with no runner before merging.",
      findings: [
        {
          priority: "P1",
          title: "A waiting job has no label",
          path: "src/queue.ts",
          startLine: 8,
          endLine: 10,
          body: "label() calls toUpperCase on job.runner, which is null for every job still waiting. Listing the queue with a waiting job throws. Return a fixed label when runner is null.",
          rule: null,
        },
      ],
    },
  },
] as const;
