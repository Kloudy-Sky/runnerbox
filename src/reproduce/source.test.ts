import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkPrivateRepo, readSourceToken } from "./source.ts";

test("the source token can't be the file, or the token, that mints runners", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rbx-source-"));
  try {
    const minting = join(dir, "token");
    const source = join(dir, "source-token");
    const copy = join(dir, "copy");
    await writeFile(minting, "github_pat_minting\n", { mode: 0o600 });
    await writeFile(source, "github_pat_contents_read\n", { mode: 0o600 });
    await writeFile(copy, "github_pat_minting\n", { mode: 0o600 });
    await symlink(minting, join(dir, "link"));
    assert.equal(await readSourceToken(source, minting), "github_pat_contents_read");
    for (const path of [minting, join(dir, "link"), copy]) await assert.rejects(readSourceToken(path, minting), /must not be the token that mints runners/);
    await assert.rejects(readSourceToken(join(dir, "missing"), minting), /ENOENT/);
    await writeFile(join(dir, "open"), "github_pat_other\n", { mode: 0o644 });
    await assert.rejects(readSourceToken(join(dir, "open"), minting), /readable only by its owner/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only a private repository the token can read is reproduced", async () => {
  const answer = (status: number, body: object) => async () => new Response(JSON.stringify(body), { status });
  await checkPrivateRepo("owner/name", "token", answer(200, { private: true }));
  await assert.rejects(checkPrivateRepo("owner/name", "token", answer(200, { private: false })), /owner\/name is public/);
  await assert.rejects(checkPrivateRepo("owner/name", "token", answer(404, {})), /can't read owner\/name. Give it Contents: read/);
});
