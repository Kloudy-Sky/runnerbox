import type { VmConfig } from "./vm-config.ts";

// Sysbox lets a job container run its own Docker daemon without being privileged. Pinned by the
// sha256 its release notes publish. Installing it restarts Docker, which is fine on a new VM.
export const SYSBOX = {
  url: "https://github.com/nestybox/sysbox/releases/download/v0.7.1/sysbox-ce_0.7.1.linux_amd64.deb",
  sha256: "9d6d5484f980d0a17f86c492c1262015c2afb66280bdb97215b79fde6a0261c5",
};

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
    `  - curl -fsSL --retry 5 --retry-all-errors -o /tmp/sysbox.deb ${SYSBOX.url} && echo "${SYSBOX.sha256}  /tmp/sysbox.deb" | sha256sum -c - && apt-get install -y /tmp/sysbox.deb && rm /tmp/sysbox.deb`,
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
