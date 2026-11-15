import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// What a server's update downloads from is whatever this build wrote in, so a release names its
// repository and a checkout build names none.
const versionOf = (repository: string | undefined) => {
  const dir = mkdtempSync(join(tmpdir(), "runnerbox-build-"));
  try {
    const outfile = join(dir, "runnerbox.js");
    const env = { ...process.env, RUNNERBOX_UPDATE_REPO: repository ?? "" };
    execFileSync(process.execPath, ["scripts/build.ts", outfile], { env, stdio: "pipe" });
    // An environment variable at run time names nothing: only the build's own value counts.
    return execFileSync(process.execPath, [outfile, "--version"], { env: { ...process.env, RUNNERBOX_UPDATE_REPO: "other/repo" } }).toString().trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("a release build names its repository, and a checkout build names none", () => {
  assert.match(versionOf("owner/name"), /^\S+ \(releases from owner\/name\)$/);
  assert.match(versionOf(undefined), /^\S+$/);
});

test("a repository that isn't owner/name fails the build", () => {
  const result = spawnSync(process.execPath, ["scripts/build.ts", join(tmpdir(), "never.js")], { env: { ...process.env, RUNNERBOX_UPDATE_REPO: "owner/name; rm -rf ~" } });
  assert.notEqual(result.status, 0);
});
