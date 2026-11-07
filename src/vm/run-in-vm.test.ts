import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runInVm } from "./run-in-vm.ts";

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

test("the exit code comes back, and a missing ssh is null, not a crash", async () => {
  assert.equal(await runInVm({ vm, command: "x", secret: "s", sshBinary: await fakeSsh(3) }), 3);
  assert.equal(await runInVm({ vm, command: "x", secret: "s", sshBinary: join(dir, "missing") }), null);
});
