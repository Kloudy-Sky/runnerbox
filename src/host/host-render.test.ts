import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { loadLauncherConfig } from "../launcher/launcher-config.ts";
import { installPaths } from "./install-paths.ts";
import { jobScript } from "./job-script.ts";
import { jobStartedHook } from "./job-started-hook.ts";
import { pfRules } from "./pf-rules.ts";
import { setupScript } from "./setup-script.ts";
import { windowsJobStartedHook } from "./windows-hook.ts";
import { windowsJobScript } from "./windows-job-script.ts";
import { windowsRunnerScript } from "./windows-runner-script.ts";
import { windowsSetupScript } from "./windows-setup-script.ts";

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

test("every filter rule binds only the job user, and IPv6 loopback stays open to it", () => {
  const rules = pfRules(config).split("\n").filter((line) => line.startsWith("block"));
  assert.equal(rules.length, 2);
  assert.ok(rules.every((rule) => rule.endsWith(" user runnerbox")));
  assert.match(rules[1] ?? "", /on ! lo0 inet6/);
});

// Windows PowerShell on a Windows host, and PowerShell 7 where a CI image has it.
const powershell = process.platform === "win32" ? "powershell" : "pwsh";
const noPowershell = spawnSync(powershell, ["-NoProfile", "-Command", "exit 0"]).status !== 0 && "PowerShell isn't installed";
const PARSE = "$e = $null; [void][Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$null, [ref]$e); if ($e) { $e; exit 1 }";

test("the Windows scripts are valid PowerShell", { skip: noPowershell }, () => {
  const hook = windowsJobStartedHook(config.runners[0]?.allowedWorkflows ?? []);
  for (const script of [windowsSetupScript(config), windowsJobScript(config), windowsRunnerScript(config), hook]) {
    execFileSync(powershell, ["-NoProfile", "-Command", PARSE], { input: script });
  }
});

test("the Windows hook lets a listed workflow run and fails every other job", { skip: noPowershell }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-hook-"));
  after(() => rm(dir, { recursive: true }));
  const file = join(dir, "job-started.ps1");
  await writeFile(file, windowsJobStartedHook(config.runners[0]?.allowedWorkflows ?? []));
  const run = (workflowRef: string) =>
    spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file], {
      env: { ...process.env, GITHUB_WORKFLOW_REF: workflowRef },
      encoding: "utf8",
    });

  assert.equal(run("owner/name/.github/workflows/release.yml@refs/tags/v1.2.3").status, 0);
  for (const ref of ["owner/name/.github/workflows/ci.yml@refs/tags/v1.2.3", "OWNER/name/.github/workflows/release.yml@refs/heads/main", ""]) {
    const result = run(ref);
    assert.equal(result.status, 1, ref);
    assert.match(result.stdout, /^::error::This runner doesn't accept jobs/);
  }
});

test("the Windows job reads its env as literal strings", () => {
  const [runner] = config.runners;
  const script = windowsRunnerScript({ ...config, runners: [{ ...runner, name: "windows", label: "x", slots: 1, env: { NOTE: "it's $HOME" } }] });
  assert.ok(script.includes("SetEnvironmentVariable('NOTE', 'it''s $HOME')"));
});
