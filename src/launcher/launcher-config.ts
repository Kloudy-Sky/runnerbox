import { readFile } from "node:fs/promises";
import { type } from "arktype";
import { REPO_NAME } from "../github/github-client.ts";

// No whitespace, because SSH splits its known-hosts option on spaces.
const AbsolutePath = type("/^\\/\\S*$/");
const MemorySize = type("/^[0-9]+[bkmg]$/");

// One kind of runner: the label jobs ask for, and the container that serves them.
const RunnerType = type({
  "+": "reject",
  // Names this type's containers and runners, which GitHub caps in length, so it's short. It has no
  // `-`, which joins it to the install's name, so `<install>-<kind>` can't match another install's.
  name: "/^[a-z0-9]{1,20}$/",
  label: "/^[\\w.-]+$/",
  // How many of this type's runners wait for jobs at once.
  slots: "1 <= number.integer <= 64",
  // A prebuilt image's reference, or a build context on the host that `up` builds in the VM and
  // rebuilds when its files change.
  image: type("/^[a-z0-9][a-z0-9._\\/:@-]*$/").or({
    "+": "reject",
    name: "/^[a-z0-9][a-z0-9._\\/-]*$/",
    context: AbsolutePath,
  }),
  limits: {
    "+": "reject",
    memory: MemorySize,
    memoryReservation: MemorySize,
    memorySwap: MemorySize,
    cpus: "number > 0",
    pids: "number.integer > 0",
    shmSize: MemorySize,
  },
  env: { "+": "reject", "[/^[A-Za-z_][A-Za-z0-9_]*$/]": "/^[^\\0]*$/" },
  // Jobs get their own Docker daemon: the container runs under sysbox, and its image starts the
  // daemon, as runnerbox-base-docker does. The VM needs sysbox installed.
  "docker?": "boolean",
});

export type RunnerType = typeof RunnerType.infer;

const Install = {
  // Prefixes this install's containers and runners, so two installs can share a VM.
  name: "/^[a-z0-9][a-z0-9-]{0,19}$/",
  scope: type({ "+": "reject", org: "/^[A-Za-z0-9-]+$/" }).or({ "+": "reject", repo: type(REPO_NAME) }),
  // Must be readable only by its owner. It's read again for each job, so it can be rotated in place.
  tokenFile: AbsolutePath,
} as const;

// An install whose jobs run in containers inside a VM. Unknown keys are errors, so a typo in a
// limit can't silently run jobs without it.
const VmInstall = type({
  "+": "reject",
  ...Install,
  vm: {
    "+": "reject",
    host: "/^[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.:-]*$/",
    keyFile: AbsolutePath,
    knownHostsFile: AbsolutePath,
  },
  // MemAvailable each machine must have before any slot registers a runner. Every runner type
  // checks the same floor, so together they share the machine. 0 turns a check off.
  memoryFloor: { "+": "reject", hostMiB: "number.integer >= 0", vmMiB: "number.integer >= 0" },
  runners: RunnerType.array().atLeastLength(1),
});

export type VmInstall = typeof VmInstall.infer;

// One kind of runner whose jobs run on the host's own OS, as the install's job user.
const HostRunnerType = type({
  "+": "reject",
  name: "/^[a-z0-9]{1,20}$/",
  label: "/^[\\w.-]+$/",
  // The job user's home is wiped after each job, so it can serve only one job at a time.
  slots: "1",
  env: { "+": "reject", "[/^[A-Za-z_][A-Za-z0-9_]*$/]": "/^[^\\0\\n]*$/" },
  // The only workflows whose jobs may run here, matched against the job's workflow ref, such as
  // `owner/name/.github/workflows/release.yml@refs/tags/v1.2.3`. `*` matches any run of characters.
  // Any other job fails before its first step. Without this, every job that asks for the label runs.
  "allowedWorkflows?": type("/^[\\w.\\/@*-]+$/").array().atLeastLength(1),
});

export type HostRunnerType = typeof HostRunnerType.infer;

// An install whose jobs run on this machine's own OS, with no VM or container around them. See the
// threat model for what that gives up.
const HostInstall = type({
  "+": "reject",
  ...Install,
  host: {
    "+": "reject",
    // A standard OS user that exists only to run jobs. `host render` writes the script that creates it.
    user: "/^[a-z_][a-z0-9_]{0,19}$/",
  },
  memoryFloor: { "+": "reject", hostMiB: "number.integer >= 0" },
  // One kind, because every job runs as the same user and cleanup removes all that user's work.
  runners: HostRunnerType.array().exactlyLength(1),
});

export type HostInstall = typeof HostInstall.infer;

// One install's settings, kept on its host because they name local paths and the VM's address.
export const LauncherConfig = VmInstall.or(HostInstall);

export type LauncherConfig = typeof LauncherConfig.infer;

export async function loadLauncherConfig(path: string): Promise<LauncherConfig> {
  const config = LauncherConfig(JSON.parse(await readFile(path, "utf8")));
  if (config instanceof type.errors) throw new Error(`Invalid config ${path}:\n${config.summary}`);
  for (const field of ["name", "label"] as const) {
    const values = config.runners.map((runner) => runner[field]);
    const repeated = values.find((value, index) => values.indexOf(value) !== index);
    if (repeated) throw new Error(`Invalid config ${path}: two runners have the ${field} "${repeated}".`);
  }
  return config;
}
