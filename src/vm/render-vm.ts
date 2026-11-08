import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { metaData, NETWORK_CONFIG, userData } from "./cloud-init.ts";
import { createScript } from "./create-script.ts";
import { networkFilterXml } from "./network-filter.ts";
import type { VmConfig } from "./vm-config.ts";

const PUBLIC_KEY = /^(ssh-ed25519|ecdsa-sha2-nistp\d+|ssh-rsa) [A-Za-z0-9+/=]+( [^\n]*)?$/;

// Writes everything needed to build the VM into `outDir`. Nothing runs until you run create.sh.
export async function renderVm(config: VmConfig, outDir: string) {
  const sshPublicKey = (await readFile(config.sshPublicKeyFile, "utf8")).trim();
  if (!PUBLIC_KEY.test(sshPublicKey)) throw new Error(`${config.sshPublicKeyFile} isn't one SSH public key.`);

  await mkdir(join(outDir, "seed"), { recursive: true });
  const files = {
    "seed/user-data": userData(config, sshPublicKey),
    "seed/meta-data": metaData(config),
    "seed/network-config": NETWORK_CONFIG,
    "filter.xml": networkFilterXml(config),
    "create.sh": createScript(config),
  };
  for (const [path, contents] of Object.entries(files)) await writeFile(join(outDir, path), contents);
  await chmod(join(outDir, "create.sh"), 0o755);
  return Object.keys(files);
}
