// Fails if git history names a project that uses runnerbox, which should stay free of any one
// user's details. Run with: node scripts/leak-check.ts
//
// The terms are stored as SHA-256 so this file doesn't trip its own check and fork PRs need no
// repo variable. Anyone can test a guess against them, so this catches accidents and hides nothing.
// To add a term: printf %s term | shasum -a 256
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const FORBIDDEN_HASHES = new Set([
  "f7bed5a9de858cf4a466529421cb2394beafac86339684ef34b831877a0ae5d9",
  "b796ea9c633af22d0dc3cbac5563d35e554828951c9dd32eac68821f79ac6a26",
  "f5f19851b78e1330e28f7885ef47f08228a6269ad9adc3747dfddb3f74509eea",
  "255cd1b7f938e4e6bd61034be9c2cee89a79516dffa3f238f98ad12bad237621",
  "0101386706d3b9dc71574c74a160f5c0a3ce86acdc5345ac6056cf9e91a0f780",
  "5c10d6d5e87a77ecc1ab6a1362e8d56c024b25a45d57b0bd51673ece2683c821",
  "07739e59e12286989f1f8ef3abe257cc321fc532de4db505ce93bf812ced59d0",
]);

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const history = execFileSync("git", ["log", "-p", "--format=fuller", "HEAD"], {
  encoding: "utf8",
  maxBuffer: 1024 ** 3,
});

const hits = new Set<string>();
let commit = "";

for (const line of history.split("\n")) {
  commit = /^commit ([0-9a-f]{40})/.exec(line)?.[1] ?? commit;

  // "some-name" is checked whole and by part, so both hyphenated names and single words match.
  for (const [token] of line.toLowerCase().matchAll(/[a-z0-9]+(?:-[a-z0-9]+)*/g)) {
    for (const candidate of [token, ...token.split("-")]) {
      const hash = sha256(candidate);
      // Logs are public, so report the hash and never the term.
      if (FORBIDDEN_HASHES.has(hash)) hits.add(`${commit.slice(0, 12)} ${hash.slice(0, 12)}`);
    }
  }
}

if (hits.size > 0) {
  console.error(`Forbidden terms found (commit, term hash):\n${[...hits].join("\n")}`);
  process.exit(1);
}

console.log("No forbidden terms in history.");
