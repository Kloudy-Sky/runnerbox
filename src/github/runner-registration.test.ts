import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mintRegistration } from "./runner-registration.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureRequests(status = 201) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ encoded_jit_config: "jit" }), { status });
  };
  return { urls, bodies };
}

const request = { token: "t", runnerName: "box-1-1", label: "box" };

test("mints at the org or repo level with the configured label", async () => {
  const { urls, bodies } = captureRequests();

  assert.equal(await mintRegistration({ ...request, scope: { org: "acme" } }), "jit");
  await mintRegistration({ ...request, scope: { repo: "acme/app" } });

  assert.deepEqual(urls, [
    "https://api.github.com/orgs/acme/actions/runners/generate-jitconfig",
    "https://api.github.com/repos/acme/app/actions/runners/generate-jitconfig",
  ]);
  assert.deepEqual(bodies[0], {
    name: "box-1-1",
    runner_group_id: 1,
    labels: ["self-hosted", "box"],
    work_folder: "_work",
  });
});

test("a refused mint reports the status and not the token", async () => {
  captureRequests(401);
  await assert.rejects(mintRegistration({ ...request, token: "secret-token", scope: { org: "acme" } }), (error: Error) => {
    assert.equal(error.message, "GitHub returned 401");
    return true;
  });
});
