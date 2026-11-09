import type { RunnerType } from "./launcher-config.ts";

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// The name includes the install's and runner type's names, because the command below removes any
// container with this name. A shared name would let one install kill another's running job.
export const containerName = (installName: string, runnerType: string, slot: number) =>
  `${installName}-${runnerType}-slot${slot}`;

// The command the VM runs for one slot. It clears whatever the slot left behind, which also kills
// a job still running there, then becomes the container's client. Ending SSH doesn't stop a running
// container, so this removal is what ends it.
// `image` is the tag to run. One built from a context is only ever local, so it's never pulled: a
// missing tag fails at once instead of fetching whatever a registry has under that name.
export function dockerRunCommand(installName: string, runner: RunnerType, slot: number, image: string) {
  const { name, image: source, limits, env, docker = false } = runner;
  const container = shellQuote(containerName(installName, name, slot));
  return [
    `docker rm -f ${container} >/dev/null 2>&1; exec docker run --rm -i --name ${container}`,
    // Sysbox maps the container's root to an unprivileged user on the VM, so an inner Docker
    // daemon needs no --privileged.
    ...(docker ? ["--runtime=sysbox-runc"] : []),
    `--memory ${shellQuote(limits.memory)}`,
    `--memory-reservation ${shellQuote(limits.memoryReservation)}`,
    `--memory-swap ${shellQuote(limits.memorySwap)}`,
    `--cpus ${limits.cpus}`,
    `--pids-limit ${limits.pids}`,
    `--shm-size ${shellQuote(limits.shmSize)}`,
    ...Object.entries(env).map(([key, value]) => `-e ${shellQuote(`${key}=${value}`)}`),
    ...(typeof source === "string" ? [] : ["--pull never"]),
    shellQuote(image),
  ].join(" ");
}
