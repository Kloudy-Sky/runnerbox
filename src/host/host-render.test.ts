import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { loadLauncherConfig } from "../launcher/launcher-config.ts";
import { installPaths } from "./install-paths.ts";
import { jobScript } from "./job-script.ts";
import { jobStartedHook } from "./job-started-hook.ts";
import { pfRules } from "./pf-rules.ts";
import { setupScript } from "./setup-script.ts";

const loaded = await loadLauncherConfig("runnerbox.host.example.json");
if (!("host" in loaded)) throw new Error("the host example isn't a host install");
const config = loaded;

const hook = (workflowRef: string) =>
  spawnSync("bash", ["-s"], {
    input: jobStartedHook(config.runners[0]?.allowedWorkflows ?? []),
    env: { GITHUB_WORKFLOW_REF: workflowRef },
    encoding: "utf8",
  });

test("the hook lets a listed workflow run and fails every other job", () => {
  assert.equal(hook("owner/name/.github/workflows/release.yml@refs/tags/v1.2.3").status, 0);
  assert.equal(hook("owner/name/.github/workflows/release.yml@refs/heads/main").status, 0);
  for (const ref of [
    "owner/name/.github/workflows/ci.yml@refs/tags/v1.2.3",
    "owner/name/.github/workflows/release.yml@refs/heads/feature",
    "other/name/.github/workflows/release.yml@refs/tags/v1",
    "",
  ]) {
    const result = hook(ref);
    assert.equal(result.status, 1, ref);
    assert.match(result.stdout, /^::error::This runner doesn't accept jobs/);
  }
});

test("the scripts are valid bash", () => {
  for (const script of [jobScript(config), setupScript(config)]) execFileSync("bash", ["-n"], { input: script });
});

test("the job gets the hook and its env, quoted, and nothing from the caller's environment", () => {
  const [runner] = config.runners;
  const script = jobScript({ ...config, runners: [{ ...runner, name: "macos", label: "x", slots: 1, env: { NOTE: "it's $HOME" } }] });
  assert.match(script, /as_job_user env -i \\\n/);
  assert.ok(script.includes(`'NOTE=it'\\''s $HOME' \\\n`));
  assert.ok(script.includes(`'ACTIONS_RUNNER_HOOK_JOB_STARTED=${installPaths(config).jobStarted}'`));
});

test("the filter binds only the job user, and lets it reach its own loopback listeners", () => {
  const rules = pfRules(config).split("\n").filter((line) => /^(pass|block)/.test(line));
  assert.ok(rules.length > 0 && rules.every((rule) => / user (!= )?runnerbox( |$)/.test(rule)));
  assert.match(rules[0] ?? "", /^pass out quick on lo0 .* tag RUNNERBOX_RUNNERBOX$/);
  assert.match(rules[1] ?? "", /^block return in quick on lo0 .* tagged RUNNERBOX_RUNNERBOX user != runnerbox$/);
});
