import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { virsh } from "./virsh.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-test-"));
after(() => rm(dir, { recursive: true }));

// A stand-in virsh that prints the file it was given, or fails the way virsh does.
async function fakeVirsh(script: string) {
  const path = join(dir, `virsh-${Math.random().toString(36).slice(2)}`);
  await writeFile(path, `#!/bin/bash\n${script}\n`);
  await chmod(path, 0o755);
  return path;
}

test("a definition reaches virsh as a file, which is gone afterwards", { skip: process.platform === "win32" && "the stand-in is a bash script" }, async () => {
  const binary = await fakeVirsh('file="${@: -1}"; echo "$3 $file"; cat "$file"');
  const [line = "", xml] = (await virsh(["create"], "<domain/>", binary)).split("\n");
  const [command, file = ""] = line.split(" ");

  assert.equal(command, "create");
  assert.equal(xml, "<domain/>");
  await assert.rejects(writeFile(file, "", { flag: "r+" }), /ENOENT/);
});

test("a failure carries what virsh said, on one line", { skip: process.platform === "win32" && "the stand-in is a bash script" }, async () => {
  const binary = await fakeVirsh('echo "error: failed to get domain" >&2; echo "more" >&2; exit 1');
  await assert.rejects(virsh(["domstate", "x"], undefined, binary), /^Error: virsh domstate failed: error: failed to get domain more$/);
});
