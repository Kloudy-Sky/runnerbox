import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readFromVm, runInVm, sshArgs } from "./run-in-vm.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-test-"));
after(() => rm(dir, { recursive: true }));

const vm = { host: "ci@vm", keyFile: "/key", knownHostsFile: "/known" } as const;

// A stand-in ssh that records what it received.
async function fakeSsh(exitCode: number) {
  const path = join(dir, `ssh-${exitCode}`);
  await writeFile(
    path,
    `#!/bin/bash\nprintf '%s\\n' "$@" > "${path}.args"\ncat > "${path}.stdin"\nexit ${exitCode}\n`,
  );
  await chmod(path, 0o755);
  return path;
}

test("the secret goes over stdin and never into arguments, and host keys are enforced", async () => {
  const sshBinary = await fakeSsh(0);
  const code = await runInVm({ vm, command: "docker run x", secret: "top-secret", sshBinary });
  const args = await readFile(`${sshBinary}.args`, "utf8");

  assert.equal(code, 0);
  assert.equal(await readFile(`${sshBinary}.stdin`, "utf8"), "top-secret\n");
  assert.doesNotMatch(args, /top-secret/);
  assert.match(args, /StrictHostKeyChecking=yes/);
  assert.match(args, /ci@vm\ndocker run x\n$/);
});

test("a job VM is checked against the builder's host key, since it has no entry of its own", () => {
  const args = sshArgs({ ...vm, host: "ci@192.168.122.20", hostKeyAlias: "192.168.122.10" }, "true");
  assert.ok(args.includes("HostKeyAlias=192.168.122.10"));
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.ok(!sshArgs(vm, "true").some((arg) => arg.startsWith("HostKeyAlias")));
});

test("the exit code comes back, and a missing ssh is null, not a crash", async () => {
  assert.equal(await runInVm({ vm, command: "x", secret: "s", sshBinary: await fakeSsh(3) }), 3);
  assert.equal(await runInVm({ vm, command: "x", secret: "s", sshBinary: join(dir, "missing") }), null);
});

test("readFromVm returns stdout, and a failing command rejects", async () => {
  const printer = join(dir, "ssh-print");
  await writeFile(printer, `#!/bin/bash\necho "MemAvailable: 1 kB"\n`);
  await chmod(printer, 0o755);

  assert.equal(await readFromVm({ vm, command: "cat /proc/meminfo", sshBinary: printer }), "MemAvailable: 1 kB\n");
  await assert.rejects(readFromVm({ vm, command: "x", sshBinary: await fakeSsh(255) }), /ssh x failed/);
});
