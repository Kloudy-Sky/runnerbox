import { readFile } from "node:fs/promises";
import { type } from "arktype";

export const Ipv4 = type("/^((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)$/");

// How to build the VM that runs jobs or, with `jobVms`, the builder that job VMs are copied from. Unknown keys are errors, like the launcher's config.
export const VmConfig = type({
  "+": "reject",
  // The libvirt domain's name. It also names its disk, seed and network filter.
  name: "/^[a-z0-9][a-z0-9-]*$/",
  cpus: "1 <= number.integer <= 64",
  memoryMiB: "number.integer >= 512",
  diskGiB: "number.integer >= 10",
  swapGiB: "number.integer >= 0",
  // An Ubuntu 24.04 cloud image. 24.04's default kernel stays on 6.8 through updates.
  baseImage: { "+": "reject", url: "/^https:\\/\\/\\S+$/", sha256: "/^[0-9a-f]{64}$/" },
  // A libvirt NAT network and storage pool. `address` is reserved for the VM in that network's DHCP.
  network: { "+": "reject", name: "/^[\\w.-]+$/", gateway: Ipv4, address: Ipv4 },
  pool: "/^[\\w.-]+$/",
  // The key the launcher logs in with, as user `ci`. Its private half sits next to it, without `.pub`.
  sshPublicKeyFile: "/^\\/\\S*\\.pub$/",
});

export type VmConfig = typeof VmConfig.infer;

export async function loadVmConfig(path: string): Promise<VmConfig> {
  const config = VmConfig(JSON.parse(await readFile(path, "utf8")));
  if (config instanceof type.errors) throw new Error(`Invalid config ${path}:\n${config.summary}`);
  if (config.network.address === config.network.gateway) {
    throw new Error(`Invalid config ${path}: network.address can't be the gateway.`);
  }
  return config;
}
