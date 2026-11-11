import assert from "node:assert/strict";
import { test } from "node:test";
import { builderDisks } from "./builder-disks.ts";
import { jobVmXml } from "./job-vm-xml.ts";

// A libvirt whose builder has these drives, each `device source`, with every disk in pool `default`.
const libvirt = (...drives: string[]) => async (args: string[]) => {
  if (args[0] === "vol-pool") return args[1]?.startsWith("/pool/") ? "default\n" : Promise.reject(new Error("no volume"));
  const rows = drives.map((drive, index) => ` file   ${drive.replace(" ", `    sd${index}      `)}`);
  return [" Type   Device   Target   Source", "-----------------------------------", ...rows, ""].join("\n");
};

test("the builder's disk and seed are found by what they are, not by name", async () => {
  assert.deepEqual(await builderDisks("ci", "default", libvirt("disk /pool/ci-runner.qcow2", "cdrom /pool/ci-seed.iso")), {
    disk: "/pool/ci-runner.qcow2",
    seed: "/pool/ci-seed.iso",
  });
  // A path may hold spaces.
  assert.equal((await builderDisks("ci", "default", libvirt("disk /pool/my vm.qcow2"))).disk, "/pool/my vm.qcow2");
});

test("a builder with no seed, or an empty drive, gets job VMs with no seed", async () => {
  for (const drives of [["disk /pool/ci.qcow2"], ["disk /pool/ci.qcow2", "cdrom -"]]) {
    const { seed } = await builderDisks("ci", "default", libvirt(...drives));
    assert.equal(seed, undefined);
    const xml = jobVmXml({
      domain: "box-linux-slot1", cpus: 4, memoryMiB: 4096, diskPath: "/pool/box-linux-slot1.qcow2",
      seedPath: seed, network: "default", address: "192.168.122.20", filter: "box-job",
    });
    assert.ok(!xml.includes("cdrom"));
  }
});

test("a builder whose disk isn't a volume in the job VMs' pool is refused at start", async () => {
  await assert.rejects(builderDisks("ci", "jobs", libvirt("disk /pool/ci.qcow2")), /is in pool default, not in jobVms.pool jobs/);
  await assert.rejects(builderDisks("ci", "default", libvirt("disk /srv/ci.qcow2")), /is in no storage pool/);
  await assert.rejects(builderDisks("ci", "default", libvirt("cdrom /pool/seed.iso")), /has no disk kept in a file/);
});
