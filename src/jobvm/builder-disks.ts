import type { Virsh } from "./virsh.ts";

// Where libvirt keeps the builder's disk and, if it has one, its cloud-init seed. They're read from
// the builder itself, so a VM that `vm render` didn't make, with other volume names, works too.
export async function builderDisks(domain: string, virsh: Virsh) {
  const rows = (await virsh(["domblklist", domain, "--details"])).split("\n").map((line) => line.trim().split(/\s+/));
  const source = (device: string) => rows.find(([type, kind]) => type === "file" && kind === device)?.[3];
  const disk = source("disk");
  if (!disk) throw new Error(`${domain} has no disk kept in a file, so there's nothing to copy for job VMs.`);
  return { disk, seed: source("cdrom") };
}
