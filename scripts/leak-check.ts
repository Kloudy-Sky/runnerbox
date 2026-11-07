// Fails if git history or PR metadata names a project that uses runnerbox, which should stay free
// of any one user's details. Run it before you push, because anything pushed is already public:
//   node scripts/leak-check.ts
//
// The terms are stored as SHA-256 so this file doesn't trip its own check and fork PRs need no
// repo variable. Anyone can test a guess against them, so this catches accidents and hides nothing.
// Terms must be lowercase letters, digits and hyphens, or they will never match.
// To add one: printf %s term | shasum -a 256
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

// Returns every run of consecutive words, so "a-b" is found in "x-a-b-y", "XAB" stays one word,
// and camelCase and snake_case split the same way as hyphens.
function candidates(line: string) {
  const normalized = line
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();

  return [...normalized.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)*/g)].flatMap(([token]) => {
    const words = token.split("-");
    return words.flatMap((_, start) =>
      words.slice(start).map((_, length) => words.slice(start, start + length + 1).join("-")),
    );
  });
}

// Logs are public, so hits name the term's hash and never the term.
const forbiddenIn = (line: string) =>
  candidates(line)
    .map(sha256)
    .filter((hash) => FORBIDDEN_HASHES.has(hash))
    .map((hash) => hash.slice(0, 12));

// --text reads files git treats as binary or -diff. Truly binary formats can still hide a term.
const history = execFileSync(
  "git",
  ["log", "-p", "--text", "--diff-merges=first-parent", "--format=fuller", "HEAD"],
  { encoding: "utf8", maxBuffer: 1024 ** 3 },
);

const hits = new Set<string>();
let commit = "";

for (const line of history.split("\n")) {
  commit = /^commit ([0-9a-f]{40})/.exec(line)?.[1] ?? commit;
  for (const hash of forbiddenIn(line)) hits.add(`commit ${commit.slice(0, 12)}: ${hash}`);
}

// The workflow passes the branch name, PR title and PR body, which git log can't see.
for (const line of (process.env.PR_METADATA ?? "").split("\n")) {
  for (const hash of forbiddenIn(line)) hits.add(`PR metadata: ${hash}`);
}

if (hits.size > 0) {
  console.error(`Forbidden terms found (location: term hash):\n${[...hits].join("\n")}`);
  process.exit(1);
}

console.log("No forbidden terms found.");
