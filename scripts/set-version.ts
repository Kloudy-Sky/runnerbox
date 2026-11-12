// Stamps a release's version into every workspace package.json, in the release workflow's
// checkout only, so `runnerbox.js`, the server and the app all report the version they ship as:
//   node scripts/set-version.ts <version>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";

const version = process.argv[2] ?? "";
if (!semver.valid(version)) throw new Error(`"${version}" isn't a version.`);
const root = join(import.meta.dirname, "..");
const files = ["package.json", ...["apps/server", "apps/web", "apps/desktop", "packages/contracts", "packages/client-runtime", "packages/connect"].map((dir) => join(dir, "package.json"))];
for (const file of files) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  // Only the top-level field, leaving the file's own formatting.
  const stamped = text.replace(/^(  "version": )"[^"]*"/m, `$1"${version}"`);
  if (stamped === text && !text.includes(`"version": "${version}"`)) throw new Error(`${file} has no version field to stamp.`);
  writeFileSync(path, stamped);
}
console.log(`Stamped ${version} into ${files.length} package.json files.`);
