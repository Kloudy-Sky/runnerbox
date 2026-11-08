import type { VmConfig } from "./vm-config.ts";

// JSON strings are valid YAML, so values can't break out of the document.
const yaml = JSON.stringify;

export function userData({ name, swapGiB }: VmConfig, sshPublicKey: string) {
  return [
    "#cloud-config",
    `hostname: ${yaml(name)}`,
    "users:",
    "  - name: ci",
    "    shell: /bin/bash",
    "    lock_passwd: true",
    "    ssh_authorized_keys:",
    `      - ${yaml(sshPublicKey)}`,
    "ssh_pwauth: false",
    "package_update: true",
    "packages: [docker.io, docker-buildx, qemu-guest-agent]",
    ...(swapGiB > 0 ? ["swap:", "  filename: /swapfile", `  size: ${swapGiB}G`] : []),
    "runcmd:",
    // The docker group only exists once its package is installed, so it can't go under `users`.
    "  - usermod -aG docker ci",
    "  - systemctl enable --now docker qemu-guest-agent",
    "",
  ].join("\n");
}

export const metaData = ({ name }: VmConfig) => `instance-id: ${yaml(name)}\nlocal-hostname: ${yaml(name)}\n`;

export const NETWORK_CONFIG = `version: 2
ethernets:
  id0:
    match: {name: "en*"}
    dhcp4: true
`;
