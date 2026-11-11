import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { refusePublicScope } from "./public-scope.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respondWith(body: unknown, status = 200) {
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify(body), { status });
  };
  return urls;
}

test("a private repository passes and a public one is refused", async () => {
  const urls = respondWith({ private: true });
  await refusePublicScope({ repo: "owner/name" }, "t");
  assert.deepEqual(urls, ["https://api.github.com/repos/owner/name"]);

  respondWith({ private: false });
  await assert.rejects(refusePublicScope({ repo: "owner/name" }, "t"), /owner\/name is public/);
});

test("an org is refused only when its default runner group allows public repositories", async () => {
  const urls = respondWith({ allows_public_repositories: false });
  await refusePublicScope({ org: "example" }, "t");
  assert.deepEqual(urls, ["https://api.github.com/orgs/example/actions/runner-groups/1"]);

  respondWith({ allows_public_repositories: true });
  await assert.rejects(refusePublicScope({ org: "example" }, "t"), /allows public repositories/);
});

test("a lookup that fails, answers nothing or doesn't answer is refused, without the token", async () => {
  respondWith({}, 403);
  await assert.rejects(refusePublicScope({ repo: "owner/name" }, "secret-token"), (error: Error) => {
    assert.equal(error.message, "Could not check for public repositories: GitHub returned 403");
    return true;
  });

  respondWith({});
  await assert.rejects(refusePublicScope({ org: "example" }, "t"), /didn't say/);

  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(refusePublicScope({ repo: "owner/name" }, "t"), /didn't answer/);
});
