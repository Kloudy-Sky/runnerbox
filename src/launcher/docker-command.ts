import type { LauncherConfig } from "./launcher-config.ts";

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// The name includes the install's name, because the command below removes any container with this
// name. A shared name would let one install kill another's running job.
export const containerName = (installName: string, slot: number) => `${installName}-slot${slot}`;

// The command the VM runs for one slot. It clears whatever the slot left behind, then becomes the
// container, so the job ends when the SSH session does.
export function dockerRunCommand({ name, image, limits, env }: LauncherConfig, slot: number) {
  const container = shellQuote(containerName(name, slot));
  return [
    `docker rm -f ${container} >/dev/null 2>&1; exec docker run --rm -i --name ${container}`,
    `--memory ${shellQuote(limits.memory)}`,
    `--memory-reservation ${shellQuote(limits.memoryReservation)}`,
    `--memory-swap ${shellQuote(limits.memorySwap)}`,
    `--cpus ${limits.cpus}`,
    `--pids-limit ${limits.pids}`,
    `--shm-size ${shellQuote(limits.shmSize)}`,
    ...Object.entries(env).map(([key, value]) => `-e ${shellQuote(`${key}=${value}`)}`),
    shellQuote(image),
  ].join(" ");
}
