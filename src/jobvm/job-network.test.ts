import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureJobNetwork } from "./job-network.ts";
import { jobVmXml } from "./job-vm-xml.ts";

const network = { install: "box", network: "default", gateway: "192.168.122.1", addresses: ["192.168.122.20", "192.168.122.21"] };

function libvirt(hosts: string, filterDefined: boolean) {
  const changes: string[] = [];
  return {
    changes,
    virsh: async (args: string[], stdin = "") => {
      if (args[0] === "nwfilter-dumpxml") return filterDefined ? "<filter/>" : Promise.reject(new Error("no such filter"));
      if (args[0] === "net-dumpxml") return `<network><ip><dhcp>${hosts}</dhcp></ip></network>`;
      changes.push(`${args.join(" ")}${stdin && " < xml"}`);
      return "";
    },
  };
}

test("only the missing filter and reservations are added", async () => {
  const { virsh, changes } = libvirt("<host mac='52:54:00:a8:7a:14' name='box-job-192-168-122-20' ip='192.168.122.20'/>", false);
  assert.equal(await ensureJobNetwork(network, virsh), "box-job");
  assert.deepEqual(changes, [
    "nwfilter-define < xml",
    "net-update default add-last ip-dhcp-host <host mac='52:54:00:a8:7a:15' name='box-job-192-168-122-21' ip='192.168.122.21'/> --live --config",
  ]);
});

test("an address another machine or install has reserved is refused", async () => {
  for (const taken of [
    "<host mac='52:54:00:11:22:33' name='runnerbox' ip='192.168.122.21'/>",
    // Another install's job VM at this address has the same MAC, so only the name tells them apart.
    "<host mac='52:54:00:a8:7a:15' name='other-job-192-168-122-21' ip='192.168.122.21'/>",
  ]) {
    const { virsh, changes } = libvirt(taken, true);
    await assert.rejects(ensureJobNetwork(network, virsh), /192\.168\.122\.21 is already reserved/);
    assert.deepEqual(changes, []);
  }
});

test("a job VM's interface is filtered, with the address its reservation gives it", () => {
  const xml = jobVmXml({
    domain: "box-linux-slot1", cpus: 4, memoryMiB: 4096, pool: "default", disk: "box-linux-slot1.qcow2",
    seed: "runnerbox-seed.iso", network: "default", address: "192.168.122.20", filter: "box-job",
  });
  assert.ok(xml.includes("<mac address='52:54:00:a8:7a:14'/>"));
  assert.ok(xml.includes("<filterref filter='box-job'><parameter name='IP' value='192.168.122.20'/></filterref>"));
  assert.ok(xml.includes("<on_reboot>destroy</on_reboot>"));
});
