// Signs runnerbox.js for a release, and checks a release is signed when it has to be:
//   RUNNERBOX_RELEASE_SIGNING_KEY=<PEM> node scripts/release-signature.ts sign <version> <dir>
//   node scripts/release-signature.ts verify <version> <dir>
// <dir> holds runnerbox.js and runnerbox.js.sha256. `sign` writes runnerbox.js.sig, then fails
// unless it verifies against a key in release-keys.json, so a secret and a committed key that
// don't match stop the release. `verify` passes with no keys in the list, since nothing is asked
// to be signed yet; with any, it fails unless runnerbox.js.sig is there and verifies.
import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseMessage, verifyRelease } from "../apps/server/src/update/supervisor/signature.ts";
import { readReleaseKeys } from "./release-keys.ts";

const [command, version = "", dir = ""] = process.argv.slice(2);
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

// The checksum the release lists, checked against the file it lists it for.
function checksum() {
  const listed = /^([0-9a-f]{64})\s+\*?runnerbox\.js\s*$/m.exec(readFileSync(join(dir, "runnerbox.js.sha256"), "utf8"))?.[1];
  const actual = createHash("sha256").update(readFileSync(join(dir, "runnerbox.js"))).digest("hex");
  if (listed !== actual) fail("runnerbox.js doesn't match runnerbox.js.sha256.");
  return actual;
}

if ((command !== "sign" && command !== "verify") || !version || !dir) fail("Usage: release-signature.ts sign|verify <version> <dir>");
const keys = readReleaseKeys();
const sha256 = checksum();
const signaturePath = join(dir, "runnerbox.js.sig");

if (command === "sign") {
  const pem = process.env.RUNNERBOX_RELEASE_SIGNING_KEY ?? "";
  if (pem === "") fail("RUNNERBOX_RELEASE_SIGNING_KEY is empty.");
  const signature = sign(null, Buffer.from(releaseMessage(version, sha256)), createPrivateKey(pem)).toString("base64");
  if (!verifyRelease(keys, version, sha256, signature)) fail("The signature doesn't verify against any key in release-keys.json: the release environment's key and the committed public key don't match.");
  writeFileSync(signaturePath, `${signature}\n`);
  console.log(`Signed runnerbox.js ${version}.`);
} else if (keys.length === 0) {
  console.log("release-keys.json has no keys, so this release doesn't need a signature.");
} else {
  if (!existsSync(signaturePath)) fail(`release-keys.json has a key, but runnerbox.js ${version} has no signature. Servers that check would refuse it.`);
  if (!verifyRelease(keys, version, sha256, readFileSync(signaturePath, "utf8"))) fail(`runnerbox.js.sig doesn't verify against release-keys.json for ${version}. Servers that check would refuse it.`);
  console.log(`runnerbox.js ${version} is signed by a key in release-keys.json.`);
}
