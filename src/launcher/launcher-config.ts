import { readFile } from "node:fs/promises";
import { type } from "arktype";
import { REPO_NAME } from "../github/github-client.ts";

// No whitespace, because SSH splits its known-hosts option on spaces.
const AbsolutePath = type("/^\\/\\S*$/");
const MemorySize = type("/^[0-9]+[bkmg]$/");

// One install's settings, kept on its host because they name local paths and the VM's address.
// Unknown keys are errors, so a typo in a limit can't silently run jobs without it.
export const LauncherConfig = type({
  "+": "reject",
  // Prefixes this install's containers and runners, so two installs can share a VM.
  name: "/^[a-z0-9][a-z0-9-]*$/",
  scope: type({ "+": "reject", org: "/^[A-Za-z0-9-]+$/" }).or({ "+": "reject", repo: type(REPO_NAME) }),
  label: "/^[\\w.-]+$/",
  slots: "1 <= number.integer <= 64",
  image: "/^[a-z0-9][a-z0-9._\\/:@-]*$/",
  // Must be readable only by its owner. It's read again for each job, so it can be rotated in place.
  tokenFile: AbsolutePath,
  vm: {
    "+": "reject",
    host: "/^[a-z_][a-z0-9_-]*@[A-Za-z0-9][A-Za-z0-9.:-]*$/",
    keyFile: AbsolutePath,
    knownHostsFile: AbsolutePath,
  },
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
  // MemAvailable each machine must have before a slot registers a runner. 0 turns a check off.
  memoryFloor: { "+": "reject", hostMiB: "number.integer >= 0", vmMiB: "number.integer >= 0" },
});

export type LauncherConfig = typeof LauncherConfig.infer;

export async function loadLauncherConfig(path: string): Promise<LauncherConfig> {
  const config = LauncherConfig(JSON.parse(await readFile(path, "utf8")));
  if (config instanceof type.errors) throw new Error(`Invalid config ${path}:\n${config.summary}`);
  return config;
}
