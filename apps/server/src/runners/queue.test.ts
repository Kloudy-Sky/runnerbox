import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { openSession, pairWithCode } from "@runnerbox/client-runtime";
import type { QueueView } from "@runnerbox/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { startTestServer } from "../testing/testServer.ts";
import { createGitHubReader } from "../github/githubReader.ts";
import { afterPoll, reposToPoll, runIds, waitingJobs } from "./queueRules.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-queue-"));
after(() => rm(dir, { recursive: true, force: true }));
const TOKEN = "not-a-real-token";
const TIMING = { pollMs: 50, slowMs: 300, maxBackoffMs: 400, idleMs: 200, checkMs: 20 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Waits for `ready`, so a loaded machine running every test at once doesn't fail on timing.
async function until(ready: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

// A stand-in for GitHub's API: one queued run in owner/name holding a job for the fixtures'
// example-linux label, a job for another label, and one already running. Each reply has an ETag,
// a request repeating it gets a 304, and `script` sets the budget headers or a refusal.
async function fakeGitHub() {
  const requests: { path: string; etag: string | undefined; auth: string | undefined }[] = [];
  const script = { remaining: 4000, limit: 5000, refuse: null as null | { status: number; retryAfter?: number; body?: string }, forbid: null as string | null };
  const jobs = {
    jobs: [
      { name: "test", workflow_name: "ci", status: "queued", labels: ["self-hosted", "example-linux"], created_at: "2026-11-15T12:00:00Z", html_url: "https://github.com/owner/name/actions/runs/1/job/11" },
      { name: "lint", workflow_name: "ci", status: "queued", labels: ["ubuntu-24.04"], created_at: "2026-11-15T12:00:00Z", html_url: "https://github.com/owner/name/actions/runs/1/job/12" },
      { name: "build", workflow_name: "ci", status: "in_progress", labels: ["self-hosted", "example-linux"], created_at: "2026-11-15T11:59:00Z", html_url: "https://github.com/owner/name/actions/runs/1/job/13" },
    ],
  };
  const body = (path: string) =>
    path.startsWith("/repos/owner/name/actions/runs?status=queued")
      ? { workflow_runs: [{ id: 1, created_at: "2026-11-15T12:00:00Z" }] }
      : path.startsWith("/repos/owner/name/actions/runs/1/jobs")
        ? jobs
        : path.includes("/actions/runs?")
          ? { workflow_runs: [] }
          : null;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? "";
    const etag = request.headers["if-none-match"];
    requests.push({ path, etag: typeof etag === "string" ? etag : undefined, auth: request.headers.authorization });
    const rate = { "x-ratelimit-remaining": String(script.remaining), "x-ratelimit-limit": String(script.limit), "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) };
    if (script.refuse) {
      response.writeHead(script.refuse.status, { ...rate, ...(script.refuse.retryAfter ? { "retry-after": String(script.refuse.retryAfter) } : {}) }).end(script.refuse.body ?? "{}");
      return;
    }
    if (script.forbid && path.startsWith(`/repos/${script.forbid}/`)) return void response.writeHead(403, rate).end(JSON.stringify({ message: "Resource protected by organization SAML enforcement." }));
    const reply = body(path);
    if (!reply) return void response.writeHead(404, rate).end("{}");
    const tag = `"${path}"`;
    if (etag === tag) return void response.writeHead(304, { ...rate, etag: tag }).end();
    response.writeHead(200, { ...rate, etag: tag, "content-type": "application/json" }).end(JSON.stringify(reply));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { apiBase: `http://127.0.0.1:${port}`, requests, script, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function reportEnv(name: string, mode = 0o600) {
  const path = join(dir, name);
  await writeFile(path, `GITHUB_TOKEN=${TOKEN}\n`);
  await chmod(path, mode);
  return path;
}

// A server whose queue poll talks to the stand-in, and a way to watch its queue.
async function setup(envMode = 0o600) {
  const github = await fakeGitHub();
  const server = await startTestServer({ queue: { apiBase: github.apiBase, reportEnvPath: await reportEnv(`report-${Math.random()}.env`, envMode), timing: TIMING } });
  const { code } = await server.createPairingCode(["history:read", "runners:read"]);
  const { token } = await Effect.runPromise(pairWithCode(server.baseUrl, code, "test"));
  const views: QueueView[] = [];
  const watch = () =>
    Effect.runFork(
      Effect.scoped(Effect.flatMap(openSession(server.baseUrl, token), ({ client }) => Stream.runForEach(client["runners.subscribeQueue"](), (view) => Effect.sync(() => views.push(view))))),
    );
  return {
    github,
    views,
    watch,
    stop: (fiber: Fiber.Fiber<unknown, unknown>) => Effect.runPromise(Fiber.interrupt(fiber)),
    close: async () => {
      await server.close();
      await github.close();
    },
  };
}

test("GitHub is never asked while no one watches, and stops being asked a minute after the last one leaves", async () => {
  const { github, views, watch, stop, close } = await setup();
  try {
    await sleep(300);
    assert.equal(github.requests.length, 0, "no watcher, no requests");
    const fiber = watch();
    await until(() => views.at(-1)?.status === "watching", "the first poll");
    const last = views.at(-1);
    assert.deepEqual(last?.waiting.map(({ repo, workflow, job, label }) => [repo, workflow, job, label]), [["owner/name", "ci", "test", "example-linux"]]);
    assert.ok(github.requests.every((request) => request.auth === `Bearer ${TOKEN}`));
    assert.ok(github.requests.every((request) => /^\/repos\/owner\/(name|other)\/actions\/runs/.test(request.path)), "only the synced repos, only Actions runs");
    await stop(fiber);
    await sleep(TIMING.idleMs + 150);
    const settled = github.requests.length;
    await sleep(300);
    assert.equal(github.requests.length, settled, "nothing after the idle minute");
  } finally {
    await close();
  }
});

test("a reply that hasn't changed is a 304 and changes nothing", async () => {
  const { github, views, watch, stop, close } = await setup();
  try {
    const fiber = watch();
    await until(() => github.requests.some((request) => request.etag !== undefined), "a repeated request");
    await stop(fiber);
    const repeated = github.requests.filter((request) => request.etag !== undefined);
    assert.ok(repeated.length > 0, "later polls send the ETag back");
    assert.ok(repeated.every((request) => request.etag === `"${request.path}"`));
    const watching = views.filter((view) => view.status === "watching");
    assert.ok(watching.length >= 1);
    assert.ok(watching.every((view) => view.waiting.length === 1 && view.waiting[0]?.job === "test"));
  } finally {
    await close();
  }
});

test("a short budget slows the poll, a nearly spent one stops it, and Retry-After is honoured", async () => {
  const { github, views, watch, stop, close } = await setup();
  try {
    github.script.remaining = 1000; // 20% left
    const fiber = watch();
    await until(() => views.at(-1)?.status === "slowed", "the slow pace");
    github.script.remaining = 100; // 2% left
    await until(() => views.at(-1)?.status === "paused", "the stop");
    assert.ok(views.at(-1)?.resumesAt, "it says when it starts again");
    const pausedAt = github.requests.length;
    await sleep(300);
    assert.equal(github.requests.length, pausedAt, "nothing while paused until the reset");
    await stop(fiber);
  } finally {
    await close();
  }

  const limited = await setup();
  try {
    limited.github.script.refuse = { status: 429, retryAfter: 1 };
    const fiber = limited.watch();
    await until(() => limited.views.at(-1)?.status === "paused", "the pause for Retry-After");
    const afterLimit = limited.github.requests.length;
    await sleep(600);
    assert.equal(limited.github.requests.length, afterLimit, "no request before Retry-After runs out");
    await limited.stop(fiber);
  } finally {
    await limited.close();
  }
});

test("a report.env others can read is refused, and nothing is sent", async () => {
  const { github, views, watch, stop, close } = await setup(0o644);
  try {
    const fiber = watch();
    await until(() => views.length > 0, "the first view");
    await sleep(300);
    await stop(fiber);
    assert.equal(github.requests.length, 0);
    assert.ok(views.every((view) => view.status === "off"));
  } finally {
    await close();
  }
});

test("a repo name that fails the pattern is never polled, and the rest are capped, the most active first", () => {
  const activity = [
    { repo: "owner/../evil", lastAt: 9 },
    { repo: "owner/..", lastAt: 9 },
    { repo: "https://example.com/x", lastAt: 9 },
    ...Array.from({ length: 12 }, (_, index) => ({ repo: `owner/repo${index}`, lastAt: index })),
  ];
  const { repos, leftOut } = reposToPoll(activity);
  assert.equal(repos.length, 10);
  assert.equal(repos[0], "owner/repo11");
  assert.equal(leftOut, 2);
  assert.ok(repos.every((repo) => /^owner\/repo\d+$/.test(repo)));
});

test("errors back off, doubling up to the cap, and a good reply resets the pace", () => {
  const timing = { pollMs: 20_000, slowMs: 120_000, maxBackoffMs: 300_000 };
  const error = { kind: "error", message: "GitHub answered 502" } as const;
  const delays: number[] = [];
  let failures = 0;
  for (let i = 0; i < 6; i += 1) {
    const next = afterPoll(error, failures, timing, 0);
    delays.push(next.delayMs);
    failures = next.failures;
  }
  assert.deepEqual(delays, [40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  assert.equal(afterPoll({ kind: "ok", budget: null }, failures, timing, 0).delayMs, 20_000);
});

test("a repo that refuses the token is skipped and the others still polled, but a secondary limit stops it all", async () => {
  const { github, views, watch, stop, close } = await setup();
  try {
    github.script.forbid = "owner/other";
    const fiber = watch();
    await until(() => views.at(-1)?.status === "watching" && views.at(-1)?.waiting.length === 1, "owner/name's job despite owner/other's 403");
    await stop(fiber);
  } finally {
    await close();
  }

  const secondary = await setup();
  try {
    secondary.github.script.refuse = { status: 403, body: JSON.stringify({ message: "You have exceeded a secondary rate limit." }) };
    const fiber = secondary.watch();
    await until(() => secondary.views.at(-1)?.status === "paused", "a pause for the secondary limit");
    const resumesAt = Date.parse(secondary.views.at(-1)?.resumesAt ?? "");
    assert.ok(resumesAt - Date.now() > 50_000, "at least the minute GitHub asks for");
    await secondary.stop(fiber);
  } finally {
    await secondary.close();
  }
});

test("queued runs come first, the longest waiting first, and the queued runs that don't fit are counted", () => {
  const run = (id: number, minute: number) => ({ id, created_at: `2026-11-15T12:${String(minute).padStart(2, "0")}:00Z` });
  const queued = { workflow_runs: Array.from({ length: 12 }, (_, index) => run(100 + index, 50 - index)) };
  const inProgress = { workflow_runs: [run(1, 59)] };
  const { ids, leftOut } = runIds(queued, inProgress);
  assert.equal(ids.length, 10);
  assert.equal(ids[0], 111, "the oldest queued run first");
  assert.ok(!ids.includes(1), "in-progress runs only fill what's left");
  assert.equal(leftOut, 2);
});

test("a job's names are cut short and its link kept only for a github.com page", () => {
  const body = {
    jobs: [
      { name: "x".repeat(300), workflow_name: "w".repeat(300), status: "queued", labels: ["example-linux"], created_at: "2026-11-15T12:00:00Z", html_url: "https://example.com/phish" },
    ],
  };
  const [job] = waitingJobs("owner/name", body, new Set(["example-linux"]));
  assert.equal(job?.job.length, 100);
  assert.equal(job?.workflow?.length, 100);
  assert.equal(job?.url, null);
});

test("the ETag cache keeps only what the last look asked for", async () => {
  const github = await fakeGitHub();
  try {
    const reader = createGitHubReader(github.apiBase);
    const a = "repos/owner/name/actions/runs?status=queued&per_page=20";
    const b = "repos/owner/name/actions/runs/1/jobs?filter=latest&per_page=100";
    await reader.get(a, TOKEN);
    reader.prune();
    await reader.get(b, TOKEN);
    reader.prune();
    await reader.get(a, TOKEN);
    assert.equal(github.requests.at(-1)?.etag, undefined, "a path the last look didn't ask for was dropped");
    await reader.get(b, TOKEN);
    assert.equal(github.requests.at(-1)?.etag, `"/${b}"`, "one it did ask for was kept");
  } finally {
    await github.close();
  }
});
