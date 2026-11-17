// Where a sync with T3 Code starts: which files taken from it changed upstream since, and whether
// the copies are still unedited. Reads a T3 Code checkout and fetches nothing, so fetch it first:
//   pnpm t3code-diff ~/code/t3code [--to origin/main]
// Exits 1 when the map is wrong or a copy was edited; upstream changes alone are only listed.
// Once a file has taken what it needs from upstream, mark it caught up, so the next run starts there:
//   pnpm t3code-diff ~/code/t3code --synced apps/web/src/components/ui/dialog.tsx
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { changedUpstream, editedCopies, localProblems, syncProblems, upstreamProblems } from "./t3code/check.ts";
import { loadMap, markSynced, type Relation } from "./t3code/map.ts";
import { upstreamCheckout } from "./t3code/upstream.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { to: { type: "string", default: "origin/main" }, synced: { type: "boolean", default: false } },
});
const [checkoutDir, ...syncedPaths] = positionals;
if (checkoutDir === undefined || values.synced !== syncedPaths.length > 0) {
  console.error("usage: pnpm t3code-diff <t3code checkout> [--to <ref>] [--synced <mapped path>...]");
  process.exit(2);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const map = loadMap(root);
const upstream = upstreamCheckout(checkoutDir);
const to = upstream.resolve(values.to);
const short = (commit: string) => commit.slice(0, 7);

const problems = [
  ...localProblems(root, map.entries),
  ...upstreamProblems(upstream, map.entries),
  ...(to === undefined ? [`${values.to} isn't in the checkout`] : []),
];
if (problems.length > 0 || to === undefined) {
  console.log("Can't compare with T3 Code until these are fixed:");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}

if (values.synced) {
  const blocked = syncProblems(root, upstream, map.entries, syncedPaths, to);
  if (blocked.length > 0) {
    console.log("Nothing marked:");
    for (const problem of blocked) console.log(`  ${problem}`);
    process.exit(1);
  }
  markSynced(root, syncedPaths, to);
  console.log(`Marked ${syncedPaths.length} caught up with T3 Code at ${short(to)} (${values.to}).`);
  process.exit(0);
}

const edited = editedCopies(root, upstream, map.entries);
const order: ReadonlyArray<Relation> = ["copied", "adapted", "stand-in", "follows"];
const changed = changedUpstream(upstream, map.entries, to).sort(
  (a, b) => order.indexOf(a.entry.relation) - order.indexOf(b.entry.relation) || a.entry.path.localeCompare(b.entry.path),
);

console.log(`T3 Code ${short(map.commit)}..${short(to)} (${values.to}), ${map.entries.length} files mapped\n`);

if (edited.length > 0) {
  console.log("Edited copies, which must stay unedited (move the change to a runnerbox file, or map it as adapted):");
  for (const { path, commit, upstream: [from = path] } of edited) console.log(`  ${path}\n    diff against: git show ${short(commit)}:${from}`);
  console.log();
}

if (changed.length === 0) console.log("Nothing changed upstream.");
else {
  console.log(`Changed upstream (${changed.length}):`);
  const width = Math.max(...changed.map(({ entry }) => entry.path.length));
  for (const { entry, commits } of changed) {
    console.log(`  ${entry.relation.padEnd(9)} ${entry.path.padEnd(width)}  ${commits} commit${commits === 1 ? "" : "s"}`);
    console.log(`    git -C ${checkoutDir} diff ${short(entry.commit)} ${short(to)} -- ${entry.upstream.join(" ")}`);
  }
}

process.exit(edited.length > 0 ? 1 : 0);
