import type { Virsh } from "./virsh.ts";

// Where libvirt keeps the builder's disk and, if it has one, its cloud-init seed. They're read from
// the builder itself, so a VM that `vm render` didn't make, with other volume names, works too.
// The disk has to be a volume in `pool`, because libvirt puts a copy in its source's pool, and
// job VMs and cleanup only look in `pool`.
export async function builderDisks(domain: string, pool: string, virsh: Virsh) {
  const rows = (await virsh(["domblklist", domain, "--details"]))
    .split("\n")
    // Type, device, target, then the source, which may hold spaces. An empty drive's source is `-`.
    .map((line) => /^(\S+)\s+(\S+)\s+\S+\s+(.+)$/.exec(line.trim()));
  const source = (device: string) =>
    rows.find((row) => row?.[1] === "file" && row[2] === device && row[3] !== "-")?.[3];
  const disk = source("disk");
  if (!disk) throw new Error(`${domain} has no disk kept in a file, so there's nothing to copy for job VMs.`);
  const diskPool = await virsh(["vol-pool", disk]).then((name) => name.trim(), () => null);
  if (diskPool !== pool) {
    throw new Error(`${domain}'s disk ${disk} is ${diskPool ? `in pool ${diskPool}` : "in no storage pool"}, not in jobVms.pool ${pool}.`);
  }
  return { disk, seed: source("cdrom") };
}
