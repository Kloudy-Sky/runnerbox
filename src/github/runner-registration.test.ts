import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mintRegistration, removeRunner } from "./runner-registration.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function captureRequests(status = 201) {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  globalThis.fetch = async (input, init) => {
    urls.push(`${init?.method} ${input}`);
    if (init?.body) bodies.push(JSON.parse(String(init.body)));
    return new Response(status === 204 ? null : JSON.stringify({ encoded_jit_config: "jit", runner: { id: 7 } }), { status });
  };
  return { urls, bodies };
}

const request = { token: "t", runnerName: "box-1-1", label: "box" };

test("mints at the org or repo level with the configured label", async () => {
  const { urls, bodies } = captureRequests();

  assert.deepEqual(await mintRegistration({ ...request, scope: { org: "acme" } }), { runnerId: 7, jitConfig: "jit" });
  await mintRegistration({ ...request, scope: { repo: "acme/app" } });

  assert.deepEqual(urls, [
    "POST https://api.github.com/orgs/acme/actions/runners/generate-jitconfig",
    "POST https://api.github.com/repos/acme/app/actions/runners/generate-jitconfig",
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

test("removes a runner by id in the same scope it was minted in", async () => {
  const { urls } = captureRequests(204);
  await removeRunner({ token: "t", scope: { repo: "acme/app" }, runnerId: 7 });
  assert.deepEqual(urls, ["DELETE https://api.github.com/repos/acme/app/actions/runners/7"]);
});
