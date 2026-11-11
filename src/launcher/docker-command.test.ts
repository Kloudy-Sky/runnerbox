import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { dockerRunCommand } from "./docker-command.ts";
import { loadLauncherConfig, type VmInstall } from "./launcher-config.ts";

async function example() {
  const config = await loadLauncherConfig("runnerbox.example.json");
  if (!("vm" in config)) throw new Error("the example isn't a VM install");
  return config;
}

const runner = (config: VmInstall) => {
  const [first] = config.runners;
  if (!first) throw new Error("the example has no runners");
  return first;
};

test("the command applies every limit and env var, and only removes this install's container", async () => {
  const config = await example();

  assert.equal(
    dockerRunCommand(config.name, runner(config), 2, "runnerbox-base"),
    "docker rm -f 'example-linux-slot2' >/dev/null 2>&1; exec docker run --rm -i --name 'example-linux-slot2' " +
      "--memory '3600m' --memory-reservation '1500m' --memory-swap '5g' --cpus 4 --pids-limit 4096 " +
      "--shm-size '1g' -e 'EXAMPLE_MAX_WORKERS=2' 'runnerbox-base'",
  );
});

test("env values reach docker literally, whatever they contain", async () => {
  const config = await example();
  const value = `it's $(touch /tmp/owned); "quoted"`;
  const command = dockerRunCommand(config.name, { ...runner(config), env: { VALUE: value } }, 1, "runnerbox-base");

  // A stand-in docker prints its arguments, so this runs the real quoting through a real shell.
  const docker = `docker() { [ "$1" = rm ] && return; printf '%s\\n' "$@"; }`;
  const output = execFileSync("bash", ["-c", `${docker}; ${command.replace("exec docker", "docker")}`], {
    encoding: "utf8",
  });
  assert.ok(output.split("\n").includes(`VALUE=${value}`));
});

test("an image built from a context is never pulled", async () => {
  const config = await example();
  const built = { ...runner(config), image: { name: "app", context: "/ci-image" } } as const;
  assert.match(dockerRunCommand(config.name, built, 1, "app:abc"), / --pull never 'app:abc'$/);
  assert.doesNotMatch(dockerRunCommand(config.name, runner(config), 1, "runnerbox-base"), /--pull/);
});

test("a docker kind runs under sysbox, never privileged, and other kinds are unchanged", async () => {
  const config = await example();
  const command = dockerRunCommand(config.name, { ...runner(config), docker: true }, 1, "runnerbox-base-docker");
  assert.match(command, / --runtime=sysbox-runc /);
  assert.doesNotMatch(command, /privileged|docker\.sock/);
  assert.doesNotMatch(dockerRunCommand(config.name, runner(config), 1, "runnerbox-base"), /sysbox/);
});

test("a kind with allowedWorkflows mounts a hook that fails any other workflow's job", async () => {
  const config = await example();
  const allowedWorkflows = ["owner/name/.github/workflows/*@refs/heads/main"];
  // The kind's own env can't swap the hook, because the last -e wins.
  const env = { ACTIONS_RUNNER_HOOK_JOB_STARTED: "/tmp/mine.sh" };
  const command = dockerRunCommand(config.name, { ...runner(config), allowedWorkflows, env }, 1, "runnerbox-base");

  // A stand-in docker runs the mounted hook the way the runner would, for a push and a pull request.
  const home = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
  const docker = `docker() { [ "$1" = rm ] && return; for arg; do case "$arg" in "$HOME"/*:ro) hook="\${arg%%:*}";; ACTIONS_RUNNER_HOOK_JOB_STARTED=*) where="$arg";; esac; done
    echo "$where"
    GITHUB_WORKFLOW_REF=owner/name/.github/workflows/ci.yml@refs/heads/main bash "$hook" && echo push-runs
    GITHUB_WORKFLOW_REF=owner/name/.github/workflows/ci.yml@refs/pull/7/merge bash "$hook" >/dev/null || echo pull-request-refused; }`;
  const output = execFileSync("bash", ["-c", `cd "$HOME"; ${docker}; ${command.replace("exec docker", "docker")}`], {
    encoding: "utf8",
    env: { ...process.env, HOME: home },
  });
  assert.deepEqual(output.trim().split("\n"), [
    "ACTIONS_RUNNER_HOOK_JOB_STARTED=/runnerbox/job-started.sh",
    "push-runs",
    "pull-request-refused",
  ]);
  execFileSync("rm", ["-rf", home]);
});
