import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { dockerRunCommand } from "./docker-command.ts";
import { loadLauncherConfig } from "./launcher-config.ts";

test("the command applies every limit and env var, and only removes this install's container", async () => {
  const config = await loadLauncherConfig("runnerbox.example.json");

  assert.equal(
    dockerRunCommand(config, 2, "runnerbox-base"),
    "docker rm -f 'example-slot2' >/dev/null 2>&1; exec docker run --rm -i --name 'example-slot2' " +
      "--memory '3600m' --memory-reservation '1500m' --memory-swap '5g' --cpus 4 --pids-limit 4096 " +
      "--shm-size '1g' -e 'EXAMPLE_MAX_WORKERS=2' 'runnerbox-base'",
  );
});

test("env values reach docker literally, whatever they contain", async () => {
  const config = await loadLauncherConfig("runnerbox.example.json");
  const value = `it's $(touch /tmp/owned); "quoted"`;
  const command = dockerRunCommand({ ...config, env: { VALUE: value } }, 1, "runnerbox-base");

  // A stand-in docker prints its arguments, so this runs the real quoting through a real shell.
  const docker = `docker() { [ "$1" = rm ] && return; printf '%s\\n' "$@"; }`;
  const output = execFileSync("bash", ["-c", `${docker}; ${command.replace("exec docker", "docker")}`], {
    encoding: "utf8",
  });
  assert.ok(output.split("\n").includes(`VALUE=${value}`));
});

test("an image built from a context is never pulled", async () => {
  const config = await loadLauncherConfig("runnerbox.example.json");
  const built = { ...config, image: { name: "app", context: "/ci-image" } } as const;
  assert.match(dockerRunCommand(built, 1, "app:abc"), / --pull never 'app:abc'$/);
  assert.doesNotMatch(dockerRunCommand(config, 1, "runnerbox-base"), /--pull/);
});
