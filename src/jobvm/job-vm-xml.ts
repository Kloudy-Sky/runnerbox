// A stable MAC in QEMU's local range, made from the address, so an address's DHCP reservation
// holds whichever slot uses it.
export function jobMac(address: string) {
  const octets = address.split(".").slice(1).map((octet) => Number(octet).toString(16).padStart(2, "0"));
  return ["52", "54", "00", ...octets].join(":");
}

type JobVm = {
  domain: string;
  cpus: number;
  memoryMiB: number;
  pool: string;
  // This job's own disk, a thin layer over a golden copy of the builder's.
  disk: string;
  // The builder's cloud-init seed. With the same instance id, cloud-init does nothing on boot.
  seed: string;
  network: string;
  address: string;
  filter: string;
};

// The libvirt domain for one job's VM. It's created transient, so libvirt forgets it once it stops,
// and it stops instead of rebooting, so a job can't restart into a VM nobody is watching. Every
// value comes from config that only allows characters safe in XML.
export function jobVmXml({ domain, cpus, memoryMiB, pool, disk, seed, network, address, filter }: JobVm) {
  return `<domain type='kvm'>
  <name>${domain}</name>
  <memory unit='MiB'>${memoryMiB}</memory>
  <vcpu>${cpus}</vcpu>
  <cpu mode='host-passthrough'/>
  <os><type arch='x86_64' machine='q35'>hvm</type><boot dev='hd'/></os>
  <features><acpi/><apic/></features>
  <on_poweroff>destroy</on_poweroff>
  <on_reboot>destroy</on_reboot>
  <on_crash>destroy</on_crash>
  <devices>
    <disk type='volume' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source pool='${pool}' volume='${disk}'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <disk type='volume' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source pool='${pool}' volume='${seed}'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>
    <interface type='network'>
      <mac address='${jobMac(address)}'/>
      <source network='${network}'/>
      <model type='virtio'/>
      <filterref filter='${filter}'><parameter name='IP' value='${address}'/></filterref>
    </interface>
    <console type='pty'/>
    <rng model='virtio'><backend model='random'>/dev/urandom</backend></rng>
  </devices>
</domain>
`;
}
