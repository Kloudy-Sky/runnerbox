import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { followRunnerOutput } from "./follow-runner.ts";

const dir = await mkdtemp(join(tmpdir(), "follow-runner-"));
after(() => rm(dir, { recursive: true }));
const vm = { host: "ci@vm", keyFile: "/key", knownHostsFile: "/known" };

test("whole lines reach onLine, a character split across writes arrives whole, and stop ends the reader", async () => {
  // A stand-in for `ssh … docker logs -f`: "ビ" is split between two writes, then it waits to be stopped.
  const ssh = join(dir, "ssh");
  await writeFile(ssh, `#!/bin/bash\nprintf 'x: Running job: \\343\\203'\nsleep 0.1\nprintf '\\223\\n'\nexec sleep 30\n`);
  await chmod(ssh, 0o755);
  const lines: string[] = [];
  const stop = followRunnerOutput({ vm, container: "example-linux-slot1", onLine: (line) => lines.push(line), sshBinary: ssh });
  // Waits for the line rather than a fixed time, so a machine busy with every other test can't fail it.
  const deadline = Date.now() + 5000;
  while (lines.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  stop();
  assert.deepEqual(lines, ["x: Running job: ビ"]);
});
