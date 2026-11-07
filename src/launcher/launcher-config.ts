import { readFile } from "node:fs/promises";
import { type } from "arktype";

const AbsolutePath = type("/^\\/[^\\0]*$/");
const MemorySize = type("/^[0-9]+[bkmg]$/");

// The file a project keeps next to its workflows. Unknown keys are errors, so a typo in a limit
// can't silently run jobs without it.
export const LauncherConfig = type({
  "+": "reject",
  // Prefixes this install's containers and runners, so two installs can share a VM.
  name: "/^[a-z0-9][a-z0-9-]*$/",
  scope: type({ "+": "reject", org: "/^[A-Za-z0-9-]+$/" }).or({
    "+": "reject",
    repo: "/^[\\w.-]+\\/[\\w.-]+$/",
  }),
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
  env: { "+": "reject", "[/^[A-Za-z_][A-Za-z0-9_]*$/]": "string" },
});

export type LauncherConfig = typeof LauncherConfig.infer;

export async function loadLauncherConfig(path: string): Promise<LauncherConfig> {
  const config = LauncherConfig(JSON.parse(await readFile(path, "utf8")));
  if (config instanceof type.errors) throw new Error(`Invalid config ${path}:\n${config.summary}`);
  return config;
}
