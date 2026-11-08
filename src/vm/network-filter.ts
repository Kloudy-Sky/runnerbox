import type { VmConfig } from "./vm-config.ts";

// Private, CGNAT (which includes Tailscale) and link-local (which includes cloud metadata) ranges.
// The libvirt network itself sits inside one of these, so the VM can't reach the host or its LAN.
export const BLOCKED_RANGES = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
] as const;

export const filterName = (vmName: string) => `${vmName}-isolated`;

// The libvirt nwfilter on the VM's interface. Lower priorities match first. The explicit DHCP rules
// are needed even with allow-dhcp, or the VM gets no address in this chain order.
export function networkFilterXml({ name, network }: VmConfig) {
  const { gateway } = network;
  return [
    `<filter name='${filterName(name)}' chain='root'>`,
    `  <filterref filter='no-mac-spoofing'/>`,
    `  <filterref filter='allow-arp'/>`,
    `  <filterref filter='allow-dhcp'/>`,
    `  <rule action='drop' direction='inout' priority='-900'><mac protocolid='ipv6'/></rule>`,
    `  <rule action='accept' direction='out' priority='90'><udp srcportstart='68' dstportstart='67'/></rule>`,
    `  <rule action='accept' direction='in' priority='90'><udp srcportstart='67' dstportstart='68'/></rule>`,
    `  <rule action='accept' direction='out' priority='100'><udp dstipaddr='${gateway}' dstportstart='53'/></rule>`,
    `  <rule action='accept' direction='out' priority='100'><tcp dstipaddr='${gateway}' dstportstart='53'/></rule>`,
    `  <rule action='accept' direction='in' priority='100'><tcp srcipaddr='${gateway}' dstportstart='22'/></rule>`,
    ...BLOCKED_RANGES.map(
      ([address, mask]) =>
        `  <rule action='drop' direction='out' priority='200'><all dstipaddr='${address}' dstipmask='${mask}'/></rule>`,
    ),
    `  <rule action='accept' direction='out' priority='500'><all/></rule>`,
    `  <rule action='drop' direction='inout' priority='1000'><all/></rule>`,
    `</filter>`,
    "",
  ].join("\n");
}
