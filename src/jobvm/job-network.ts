import { jobFilterName, jobFilterXml } from "../vm/network-filter.ts";
import { jobMac } from "./job-vm-xml.ts";
import type { Virsh } from "./virsh.ts";

type JobNetwork = { install: string; network: string; gateway: string; addresses: readonly string[] };

// A reservation carries its install's name, because the MAC comes from the address alone and so
// can't tell two installs apart.
const reservationName = (install: string, address: string) => `${install}-job-${address.replaceAll(".", "-")}`;

// Makes sure libvirt has the job VMs' filter and a DHCP reservation for each of their addresses.
// It only adds what's missing, and refuses an address some other machine or install already has.
// Two installs on one address would boot VMs that answer for each other.
export async function ensureJobNetwork({ install, network, gateway, addresses }: JobNetwork, virsh: Virsh) {
  // Every address is checked before anything changes, so a refusal leaves libvirt as it was.
  const hosts = (await virsh(["net-dumpxml", network])).match(/<host\b[^>]*>/g) ?? [];
  const missing = addresses.filter((address) => {
    const reserved = hosts.find((host) => host.includes(`ip='${address}'`));
    if (reserved && !reserved.includes(`name='${reservationName(install, address)}'`)) {
      throw new Error(`${address} is already reserved for another machine or install in network ${network}. Pick other jobVms.addresses.`);
    }
    return !reserved;
  });

  const filter = jobFilterName(install);
  const defined = await virsh(["nwfilter-dumpxml", filter]).then(() => true, () => false);
  if (!defined) await virsh(["nwfilter-define"], jobFilterXml(install, gateway));
  for (const address of missing) {
    await virsh(["net-update", network, "add-last", "ip-dhcp-host", `<host mac='${jobMac(address)}' name='${reservationName(install, address)}' ip='${address}'/>`, "--live", "--config"]);
  }
  return filter;
}
