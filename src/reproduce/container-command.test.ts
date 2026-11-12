import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { containerFlags, dockerRunCommand } from "../launcher/docker-command.ts";
import { loadLauncherConfig, type RunnerType } from "../launcher/launcher-config.ts";
import { execCommand, reproduceRunCommand, sweepCommand, unpackCommand } from "./container-command.ts";

async function exampleRunner(): Promise<RunnerType> {
  const config = await loadLauncherConfig("runnerbox.example.json");
  if (!("vm" in config) || !config.runners[0]) throw new Error("the example isn't a VM install with a runner");
  return config.runners[0];
}

// Runs a VM command through a real shell, with a stand-in docker that records its arguments and
// stdin, so quoting is checked the way the VM will see it.
function runWithFakeDocker(command: string, stdin: string) {
  const dir = mkdtempSync(join(tmpdir(), "runnerbox-repro-"));
  const docker = `docker() { printf '%s\\n' "$@" > ${dir}/args; cat > ${dir}/stdin; }`;
  execFileSync("bash", ["-c", `${docker}; ${command.replaceAll("exec docker", "docker")}`], { input: stdin, cwd: dir });
  return { args: readFileSync(join(dir, "args"), "utf8").split("\n").slice(0, -1), stdin: readFileSync(join(dir, "stdin"), "utf8"), dir };
}

test("a reproduce container gets a job container's runtime, limits and env, with no mounts, stdin or registration", async () => {
  for (const runner of [await exampleRunner(), { ...(await exampleRunner()), docker: true }]) {
    const command = reproduceRunCommand("example", runner, "0a1b2c3d", "runnerbox-base");
    const flags = containerFlags(runner).join(" ");
    assert.ok(dockerRunCommand("example", runner, 1, "runnerbox-base").includes(flags), "jobs use the same flags");
    assert.ok(command.includes(flags), "and so does a reproduce");
    assert.equal(runner.docker === true, command.includes("--runtime=sysbox-runc"));
    assert.doesNotMatch(command, / -v | --volume| --mount| -i | --interactive| --privileged| -e ACTIONS_/);
    assert.match(command, /docker run -d --rm --name 'example-repro-0a1b2c3d' --label 'runnerbox.reproduce=example' /);
    assert.match(command, /--entrypoint sleep 'runnerbox-base' infinity$/);
  }
});

test("a command reaches the container as data, never as part of the VM's shell command", () => {
  const hostile = `echo hi; $(touch owned-by-vm-shell) '"; rm -rf / #`;
  const command = execCommand("example", "0a1b2c3d", 300);
  assert.ok(!command.includes("owned"));
  const { args, stdin, dir } = runWithFakeDocker(command, hostile);
  assert.deepEqual(args.slice(0, 6), ["exec", "-i", "-w", "/work", "example-repro-0a1b2c3d", "sh"]);
  assert.equal(args[6], "-c");
  assert.equal(args[7], `cat > /tmp/.runnerbox-command && exec timeout -k 5 300 "$(command -v bash || echo sh)" /tmp/.runnerbox-command </dev/null 2>&1`);
  assert.equal(stdin, hostile);
  assert.equal(existsSync(join(dir, "owned-by-vm-shell")), false);
  assert.throws(() => execCommand("example", "not-an-id; rm -rf /", 300));
  assert.throws(() => execCommand("example", "0a1b2c3d", 1.5));
});

test("files are unpacked from stdin, and the sweep only touches this install's reproduce containers", () => {
  assert.deepEqual(runWithFakeDocker(unpackCommand("example", "0a1b2c3d"), "tar bytes").args, ["exec", "-i", "-w", "/work", "example-repro-0a1b2c3d", "tar", "-xz", "--strip-components=1", "-f", "-"]);
  assert.match(sweepCommand("example"), /^docker ps -aq --filter 'label=runnerbox\.reproduce=example' \| xargs -r docker rm -f/);
});
