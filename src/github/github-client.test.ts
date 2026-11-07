import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createGitHubClient } from "./github-client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("stops before using up the requests other tools need, without exposing the token", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ jobs: [] }), {
      headers: { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "999", "x-ratelimit-reset": "1800000000" },
    });

  await assert.rejects(createGitHubClient("secret-token").jobs("acme/app", 1), (error: Error) => {
    assert.match(error.message, /Stopped with 999 GitHub requests left/);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
});

test("a token with a small hourly limit can still sync", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ jobs: [] }), {
      headers: { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "900" },
    });

  assert.deepEqual(await createGitHubClient("t").jobs("acme/app", 1), []);
});

test("reads every page of a run's jobs", async () => {
  const job = (id: number) => ({
    id,
    run_id: 1,
    run_attempt: 1,
    name: "test",
    conclusion: "success",
    created_at: "2026-01-01T00:00:00Z",
    started_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:01Z",
    runner_name: "box",
    labels: [],
    head_branch: null,
    workflow_name: null,
  });
  globalThis.fetch = async (input) => {
    const page = new URL(String(input)).searchParams.get("page");
    const jobs = page === "1" ? Array.from({ length: 100 }, (_, i) => job(i)) : [job(100)];
    return new Response(JSON.stringify({ jobs }));
  };

  assert.equal((await createGitHubClient("t").jobs("acme/app", 1)).length, 101);
});
