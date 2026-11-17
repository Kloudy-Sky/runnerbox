import assert from "node:assert/strict";
import { test } from "node:test";
import type { Check, InboxItem, PullRequest } from "@runnerbox/contracts";
import { machineFailureFor } from "./machineFailure.ts";

const head = "a".repeat(40);
const pull: PullRequest = { repo: "owner/name", number: 40, title: "A change", author: "someone", branch: "fix", base: "main", headSha: head, draft: false, openedAt: "2026-11-15T10:00:00Z", updatedAt: "2026-11-15T10:00:00Z" };
const check = (change: Partial<Check>): Check => ({ name: "e2e", workflow: "ci", state: "failed", startedAt: null, durationMs: null, ...change });
const item = (headSha: string): InboxItem => ({
  id: "failure:owner/name\0ci\0e2e:infra", kind: "failure", group: "needs_you", quiet: null, verdict: "infra", repo: "owner/name", install: null,
  title: "e2e fails on this machine, not in its code", happened: "", why: "", action: "", at: "2026-11-15T10:00:00Z",
  evidence: { steps: [], attempts: [{ jobId: 1, attempt: 1, runId: 1, headSha, runner: null, runnerType: "vm", conclusion: "failure", startedAt: null, durationMs: null }], machine: null, launcher: [], durations: [], reasons: [], breakdown: [] },
});

test("a failed check links to the machine's inbox item only when that item failed on the pull request's head commit", () => {
  assert.equal(machineFailureFor(pull, check({}), [item(head)])?.verdict, "infra");
  assert.equal(machineFailureFor(pull, check({}), [item("b".repeat(40))]), null);
  assert.equal(machineFailureFor(pull, check({ workflow: null }), [item(head)]), null);
  assert.equal(machineFailureFor(pull, check({ name: "lint" }), [item(head)]), null);
});
