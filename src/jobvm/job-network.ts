import { jobFilterName, jobFilterXml } from "../vm/network-filter.ts";
import { jobMac } from "./job-vm-xml.ts";
import type { Virsh } from "./virsh.ts";

type JobNetwork = { install: string; network: string; gateway: string; addresses: readonly string[] };

// Makes sure libvirt has the job VMs' filter and a DHCP reservation for each of their addresses.
// It only adds what's missing, and refuses an address some other machine already has.
export async function ensureJobNetwork({ install, network, gateway, addresses }: JobNetwork, virsh: Virsh) {
  // Every address is checked before anything changes, so a refusal leaves libvirt as it was.
  const hosts = (await virsh(["net-dumpxml", network])).match(/<host\b[^>]*>/g) ?? [];
  const missing = addresses.filter((address) => {
    const reserved = hosts.find((host) => host.includes(`ip='${address}'`));
    if (reserved && !reserved.includes(`mac='${jobMac(address)}'`)) {
      throw new Error(`${address} is already reserved for another machine in network ${network}. Pick other jobVms.addresses.`);
    }
    return !reserved;
  });

  const filter = jobFilterName(install);
  const defined = await virsh(["nwfilter-dumpxml", filter]).then(() => true, () => false);
  if (!defined) await virsh(["nwfilter-define", "/dev/stdin"], jobFilterXml(install, gateway));
  for (const address of missing) {
    await virsh(["net-update", network, "add-last", "ip-dhcp-host", `<host mac='${jobMac(address)}' ip='${address}'/>`, "--live", "--config"]);
  }
  return filter;
}
