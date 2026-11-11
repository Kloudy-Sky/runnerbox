import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type } from "arktype";
import { userData } from "./cloud-init.ts";
import { createScript, macAddress } from "./create-script.ts";
import { networkFilterXml } from "./network-filter.ts";
import { renderVm } from "./render-vm.ts";
import { VmConfig } from "./vm-config.ts";

const example = VmConfig(JSON.parse(await readFile(new URL("../../runnerbox.vm.example.json", import.meta.url), "utf8")));
if (example instanceof type.errors) throw new Error(example.summary);
const config = example;

test("the example config is valid, and unknown keys are rejected", () => {
  assert.ok(VmConfig({ ...config, extra: true }) instanceof type.errors);
});

test("the filter lets DHCP and DNS through before it drops private ranges, and accepts the rest after", () => {
  const rules = networkFilterXml(config).split("\n");
  const index = (needle: string) => rules.findIndex((rule) => rule.includes(needle));

  assert.ok(index("dstportstart='67'") < index("dstipaddr='10.0.0.0'"));
  assert.ok(index("dstipaddr='192.168.122.1' dstportstart='53'") < index("dstipaddr='192.168.0.0'"));
  assert.ok(index("dstipaddr='169.254.0.0'") < index("priority='500'><all/>"));
  assert.match(rules.at(-3) ?? "", /action='drop' direction='inout' priority='1000'/);
});

test("the docker group is added after install, and swap only when asked for", () => {
  const withSwap = userData(config, "ssh-ed25519 AAAA key");
  assert.match(withSwap, /runcmd:\n {2}- usermod -aG docker ci/);
  assert.match(withSwap, /size: 4G/);
  assert.doesNotMatch(userData({ ...config, swapGiB: 0 }, "ssh-ed25519 AAAA key"), /swap:/);
});

test("cloud-init installs sysbox only after checking its pinned checksum", () => {
  assert.match(userData(config, "ssh-ed25519 AAAA key"), /sha256sum -c - && apt-get install -y \/tmp\/sysbox\.deb/);
});

test("the MAC is stable per VM name and in QEMU's range", () => {
  assert.equal(macAddress("runnerbox"), macAddress("runnerbox"));
  assert.notEqual(macAddress("runnerbox"), macAddress("other"));
  assert.match(macAddress("runnerbox"), /^52:54:00(:[0-9a-f]{2}){3}$/);
});

test("create.sh is valid bash", () => {
  execFileSync("bash", ["-n"], { input: createScript(config) });
});

test("render refuses a key file that isn't one public key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runnerbox-vm-"));
  const keyFile = `/${dir.slice(1)}/key.pub` as const;
  await writeFile(keyFile, "ssh-ed25519 AAAA one\nssh-ed25519 BBBB two\n");
  await assert.rejects(renderVm({ ...config, sshPublicKeyFile: keyFile }, join(dir, "out")), /isn't one SSH public key/);
});

test("the filter pins the VM to its reserved address and drops multicast and broadcast", () => {
  const xml = networkFilterXml(config);
  const ownAddress = `<parameter name='IP' value='${config.network.address}'/>`;
  assert.ok(xml.includes(`<filterref filter='no-ip-spoofing'>${ownAddress}</filterref>`));
  assert.ok(xml.includes(`<filterref filter='no-arp-spoofing'>${ownAddress}</filterref>`));
  assert.ok(xml.includes("dstipaddr='224.0.0.0' dstipmask='4'"));
  assert.ok(xml.includes("dstipaddr='255.255.255.255' dstipmask='32'"));
});

test("create.sh's checks hold when virsh is still writing after the line they look for", async (t) => {
  const bin = await mkdtemp(join(tmpdir(), "runnerbox-bin-"));
  t.after(() => rm(bin, { recursive: true }));
  // A virsh that keeps printing after the answer, as a real one can. A check that stops reading
  // early kills it, and with pipefail that reads as the network being down.
  const virsh = `#!/bin/bash
case "$1" in
  net-info) echo "Active:         yes"; sleep 0.2; for _ in $(seq 2000); do echo "Bridge:         virbr0"; done ;;
  pool-info) echo "State:          inactive" ;;
esac`;
  for (const tool of ["virt-install", "qemu-img", "xorriso", "curl", "sha256sum", "ssh"]) {
    await writeFile(join(bin, tool), "#!/bin/bash\n");
    await chmod(join(bin, tool), 0o755);
  }
  await writeFile(join(bin, "virsh"), virsh);
  await chmod(join(bin, "virsh"), 0o755);

  // The network check passes, so the script stops at the next one, the pool this stub reports down.
  assert.throws(
    () => execFileSync("bash", ["-s"], { input: createScript(config), env: { PATH: `${bin}:/usr/bin:/bin` }, stdio: ["pipe", "pipe", "pipe"] }),
    /Storage pool default isn't running/,
  );
});
