import assert from "node:assert/strict";
import { test } from "node:test";
import type { CiJob, CiRepo } from "@runnerbox/contracts";
import { patchLanded } from "./patchLanded.ts";

const job = (state: CiJob["state"]): CiJob => ({ workflow: ".github/workflows/ci.yml", job: "test", runsOn: "ubuntu-latest", state, variable: state === "left" ? null : "LINUX_RUNNER", docker: null });
const repo = (over: Partial<CiRepo>): CiRepo => ({ repo: "owner/name", jobs: [], patch: null, problem: null, switch: "ready", variables: [], approveUrl: null, ...over });

test("the patch has landed once its jobs read the variable on a clean read", () => {
  assert.equal(patchLanded(repo({ jobs: [job("moves")] })), true);
  assert.equal(patchLanded(repo({ jobs: [job("patched")], patch: "diff" })), false);
});

test("a read that failed, or found no workflows, isn't a landing", () => {
  assert.equal(patchLanded(repo({ jobs: [], problem: "Couldn't read the workflows on owner/name." })), false);
  assert.equal(patchLanded(repo({ jobs: [] })), false);
  assert.equal(patchLanded(repo({ jobs: [job("moves")], problem: "Couldn't read .github/workflows/ci.yml, so its jobs aren't listed." })), false);
});
