import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = new URL("./release-signature.ts", import.meta.url).pathname;
const VERSION = "0.3.2-nightly.20261115.1";

const throwawayKey = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(), privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
};

// A release directory as the cli job leaves it, and a checkout holding `keys` in release-keys.json.
function withRelease(keys: ReadonlyArray<string>, body: (run: (command: string, secret?: string) => { status: number | null; output: string }, dir: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "runnerbox-signing-"));
  try {
    const dir = join(root, "assets");
    mkdirSync(dir);
    writeFileSync(join(dir, "runnerbox.js"), "// runnerbox.js\n");
    writeFileSync(join(dir, "runnerbox.js.sha256"), `${createHash("sha256").update("// runnerbox.js\n").digest("hex")}  runnerbox.js\n`);
    writeFileSync(join(root, "release-keys.json"), JSON.stringify({ keys: keys.map((publicKey, index) => ({ id: `key${index}`, publicKey })) }));
    body((command, secret) => {
      const result = spawnSync(process.execPath, [SCRIPT, command, VERSION, dir], { cwd: root, encoding: "utf8", env: { ...process.env, RUNNERBOX_RELEASE_SIGNING_KEY: secret ?? "" } });
      return { status: result.status, output: result.stdout + result.stderr };
    }, dir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("with no key committed, a release needs no signature", () => {
  withRelease([], (run) => {
    const verified = run("verify");
    assert.equal(verified.status, 0);
    assert.match(verified.output, /doesn't need a signature/);
  });
});

test("a release signed with the committed key verifies, and publishing checks it", () => {
  const key = throwawayKey();
  withRelease([key.publicKey], (run) => {
    assert.equal(run("sign", key.privateKey).status, 0);
    assert.equal(run("verify").status, 0);
  });
});

test("a secret that doesn't match the committed key fails the release before anything ships", () => {
  const [committed, secret] = [throwawayKey(), throwawayKey()];
  withRelease([committed.publicKey], (run, dir) => {
    const signed = run("sign", secret.privateKey);
    assert.equal(signed.status, 1);
    assert.match(signed.output, /don't match/);
    assert.ok(!existsSync(join(dir, "runnerbox.js.sig")), "no signature was written");
  });
});

test("with a key committed, publishing fails on a missing or wrong signature", () => {
  const [key, other] = [throwawayKey(), throwawayKey()];
  withRelease([key.publicKey], (run, dir) => {
    const missing = run("verify");
    assert.equal(missing.status, 1);
    assert.match(missing.output, /has no signature/);
    writeFileSync(join(dir, "runnerbox.js.sig"), "AAAA\n");
    assert.equal(run("verify").status, 1);
  });
  // While keys rotate, the list holds both, and the newer one signs.
  withRelease([other.publicKey, key.publicKey], (run) => assert.equal(run("sign", key.privateKey).status, 0));
});

test("a release-keys.json that isn't a list of Ed25519 public keys stops the build", () => {
  withRelease(["-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----"], (run) => assert.notEqual(run("verify").status, 0));
});
