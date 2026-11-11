import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readTokenFile } from "./token-file.ts";

const dir = await mkdtemp(join(tmpdir(), "runnerbox-test-"));
after(() => rm(dir, { recursive: true }));

test("reads an owner-only token, and refuses one others could read", async () => {
  const safe = join(dir, "safe");
  await writeFile(safe, "token\n", { mode: 0o600 });
  assert.equal(await readTokenFile(safe), "token");

  const open = join(dir, "open");
  await writeFile(open, "token\n", { mode: 0o644 });
  // Windows has no mode bits: there the owner's profile is what keeps other accounts out.
  if (process.platform !== "win32") await assert.rejects(readTokenFile(open), /chmod 600/);
});
