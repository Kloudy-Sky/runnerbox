import { readFile } from "node:fs/promises";
import { type } from "arktype";
import { REPO_NAME } from "../github/github-client.ts";
import { Ipv4 } from "../vm/vm-config.ts";

// No whitespace, because SSH splits its known-hosts option on spaces.
const AbsolutePath = type("/^\\/\\S*$/");
const MemorySize = type("/^[0-9]+[bkmg]$/");
// The only workflows whose jobs may run on a kind, matched against the job's workflow ref, such as
// `owner/name/.github/workflows/release.yml@refs/tags/v1.2.3`. `*` matches any run of characters.
// Any other job fails before its first step. Without this, every job that asks for the label runs.
const AllowedWorkflows = type("/^[\\w.\\/@*-]+$/").array().atLeastLength(1);

// MemAvailable each machine must have before a slot registers a runner. 0 turns a check off.
const MemoryFloor = type({ "+": "reject", hostMiB: "number.integer >= 0", vmMiB: "number.integer >= 0" });

export type MemoryFloor = typeof MemoryFloor.infer;

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
  "allowedWorkflows?": AllowedWorkflows,
  // The size of the VM each of this kind's jobs gets to itself. The container and its limits still
  // apply inside it. Needs the install's `jobVms`.
  "vm?": { "+": "reject", cpus: "1 <= number.integer <= 64", memoryMiB: "number.integer >= 1024" },
  // Replaces the install's floor for this kind, so a kind of small jobs can start while bigger ones wait.
  "memoryFloor?": MemoryFloor,
});

export type RunnerType = typeof RunnerType.infer;

const Install = {
  // Prefixes this install's containers and runners, so two installs can share a VM.
  name: "/^[a-z0-9][a-z0-9-]{0,19}$/",
  scope: type({ "+": "reject", org: "/^[A-Za-z0-9-]+$/" }).or({ "+": "reject", repo: type(REPO_NAME) }),
  // Must be readable only by its owner. It's read again for each job, so it can be rotated in place.
  tokenFile: AbsolutePath,
  // Off by default, so `up` refuses a scope that a public repository's jobs could reach.
  allowPublicRepos: "boolean = false",
} as const;

// An install whose jobs run in containers inside a VM. Unknown keys are errors, so a typo in a
// limit can't silently run jobs without it.
export const VmInstall = type({
  "+": "reject",
  ...Install,
  vm: {
    "+": "reject",
    host: "/^[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.:-]*$/",
    keyFile: AbsolutePath,
    knownHostsFile: AbsolutePath,
  },
  // Every runner type checks this floor unless it sets its own, so together they share the machine.
  memoryFloor: MemoryFloor,
  // Runs every job in its own VM, a copy of the VM above, which then only builds images. `builder`
  // is that VM's libvirt domain, and each slot needs one of `addresses`, free in `network`.
  "jobVms?": {
    "+": "reject",
    builder: "/^[a-z0-9][a-z0-9-]*$/",
    pool: "/^[\\w.-]+$/",
    network: "/^[\\w.-]+$/",
    gateway: Ipv4,
    addresses: Ipv4.array().atLeastLength(1),
  },
  runners: RunnerType.array().atLeastLength(1),
  // Lets `runnerbox serve` ask for a throwaway container on a kind's image, with a commit's files,
  // to rerun a failing step in. `sourceTokenFile` holds a token that can only read the code
  // (Contents: read), never the token that mints runners. Without this block there's no socket.
  "reproduce?": { "+": "reject", sourceTokenFile: AbsolutePath },
  // Lets the owner approve, in the desktop app, a change to this install's numbers that an agent
  // proposed: a kind's slots and limits, and memory floors. `up` checks each one itself and writes
  // this file. Without it, nothing can change it but the owner.
  "changes?": "true",
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
  "allowedWorkflows?": AllowedWorkflows,
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
  memoryFloor: MemoryFloor.omit("vmMiB"),
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
  if ("vm" in config) checkJobVms(config, (problem) => new Error(`Invalid config ${path}: ${problem}`));
  return config;
}

// What the schema can't say about an install's job VMs. Throws what `fail` makes of the first problem.
function checkJobVms(config: VmInstall, fail: (problem: string) => Error) {
  const { jobVms, runners } = config;
  if (!jobVms) {
    if (runners.some((runner) => runner.vm)) throw fail("a runner has `vm`, which needs `jobVms`.");
    // Jobs sharing a VM can reach each other through one container escape, and on a public
    // repository anyone can send a job.
    if (config.allowPublicRepos) throw fail("allowPublicRepos needs `jobVms`, so a stranger's job gets a VM to itself.");
    return;
  }
  // One install can't mix the two, because copying the builder's disk shuts it down, and that would
  // kill a job running in it.
  if (!runners.every((runner) => runner.vm)) throw fail("with `jobVms`, every runner needs `vm`.");
  if ([config, ...runners].some(({ memoryFloor }) => memoryFloor && memoryFloor.vmMiB !== 0)) {
    throw fail("with `jobVms`, set every memoryFloor.vmMiB to 0. Jobs don't run in that VM.");
  }
  const { addresses, gateway } = jobVms;
  if (new Set([...addresses, gateway]).size !== addresses.length + 1) {
    throw fail("jobVms.addresses must differ from each other and from the gateway.");
  }
  const slots = runners.reduce((sum, runner) => sum + runner.slots, 0);
  if (slots > addresses.length) throw fail(`${slots} slots need ${slots} jobVms.addresses, and there are ${addresses.length}.`);
}
