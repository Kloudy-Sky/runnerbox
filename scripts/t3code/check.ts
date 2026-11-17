// What `pnpm t3code-diff` checks: the map's own problems, copies that were edited, the entries whose
// upstream files moved on since they were taken, and whether entries can be marked caught up.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUT_MARKER, STAND_IN_MARKER, type Entry } from "./map.ts";
import type { UpstreamCheckout } from "./upstream.ts";

const firstLine = (root: string, path: string) => readFileSync(join(root, path), "utf8").split("\n", 1)[0] ?? "";

// Files that contain `text`, tracked or not. git grep exits 1 when nothing matches.
function filesContaining(root: string, text: string, pathspecs: ReadonlyArray<string> = []) {
  const grep = spawnSync("git", ["-C", root, "grep", "-l", "--untracked", "-F", text, "--", ...pathspecs], { encoding: "utf8" });
  if (grep.status !== 0 && grep.status !== 1) throw new Error(`git grep failed in ${root}: ${grep.stderr}`);
  return grep.stdout.split("\n").filter((path) => path !== "");
}

// Files whose first line marks them as stand-ins.
const markedStandIns = (root: string) => filesContaining(root, STAND_IN_MARKER).filter((path) => firstLine(root, path).includes(STAND_IN_MARKER));

// Code that names T3 Code without taking anything from it: what lets the copies build, runnerbox's
// overrides of them, and a settings part T3 Code doesn't have. Prose, and this tool, are left out.
const MENTIONS_ONLY = new Set([
  "apps/web/scripts/testAliases.ts",
  "apps/web/src/components/settings/SettingsIntro.tsx",
  "apps/web/src/styles.css",
  "apps/web/src/theme/runnerbox.css",
  "apps/web/src/vite-env.d.ts",
  "apps/web/tsconfig.json",
  "apps/web/vite.config.ts",
]);
const NOT_CODE = [":!*.md", ":!docs/t3code-map.json", ":!scripts/t3code-diff.ts", ":!scripts/t3code/"];

// Code that mentions T3 Code, which usually means it was taken from it, and isn't mapped: neither an
// entry itself nor inside an entry that's a directory.
const unmappedMentions = (root: string, entries: ReadonlyArray<Entry>) =>
  filesContaining(root, "T3 Code", NOT_CODE).filter(
    (path) => !MENTIONS_ONLY.has(path) && !entries.some((entry) => path === entry.path || path.startsWith(`${entry.path}/`)),
  );

// Problems found without T3 Code: a mapped path that isn't here, an adapted file with no cut marked,
// a stand-in that's marked but not mapped or mapped but not marked, and code that mentions T3 Code
// without an entry.
export function localProblems(root: string, entries: ReadonlyArray<Entry>) {
  const missing = entries.filter((entry) => !existsSync(join(root, entry.path)));
  const present = entries.filter((entry) => !missing.includes(entry));
  const marked = new Set(markedStandIns(root));
  const mapped = new Set(present.filter((entry) => entry.relation === "stand-in").map((entry) => entry.path));
  return [
    ...missing.map((entry) => `${entry.path}: mapped, but not in runnerbox`),
    ...present
      .filter((entry) => entry.relation === "adapted" && !readFileSync(join(root, entry.path), "utf8").includes(CUT_MARKER))
      .map((entry) => `${entry.path}: adapted, but no \`${CUT_MARKER}\` marks a cut`),
    ...[...marked].filter((path) => !mapped.has(path)).map((path) => `${path}: marked as a stand-in, but not mapped as one`),
    ...[...mapped].filter((path) => !marked.has(path)).map((path) => `${path}: mapped as a stand-in, but its first line doesn't say "${STAND_IN_MARKER}"`),
    ...unmappedMentions(root, entries).map((path) => `${path}: mentions T3 Code, but isn't mapped`),
  ];
}

// Problems only the checkout can show: a commit it doesn't have, or an upstream path that wasn't
// there at the entry's commit.
export function upstreamProblems(upstream: UpstreamCheckout, entries: ReadonlyArray<Entry>) {
  const commits = [...new Set(entries.map((entry) => entry.commit))];
  const absent = new Set(commits.filter((commit) => upstream.resolve(commit) === undefined));
  return [
    ...[...absent].map((commit) => `commit ${commit} isn't in the checkout: run git fetch there`),
    ...entries
      .filter((entry) => !absent.has(entry.commit))
      .flatMap((entry) =>
        entry.upstream
          .filter((path) => !upstream.has(entry.commit, path))
          .map((path) => `${entry.path}: upstream ${path} doesn't exist at ${entry.commit.slice(0, 7)}`),
      ),
  ];
}

// Copies that no longer match upstream at their commit. Adapted files are expected to differ.
export const editedCopies = (root: string, upstream: UpstreamCheckout, entries: ReadonlyArray<Entry>) =>
  entries.filter(
    (entry) =>
      entry.relation === "copied" && !readFileSync(join(root, entry.path)).equals(upstream.read(entry.commit, entry.upstream[0] ?? entry.path)),
  );

// Entries whose upstream changed between their commit and `to`, with how many commits touched it.
export const changedUpstream = (upstream: UpstreamCheckout, entries: ReadonlyArray<Entry>, to: string) =>
  entries
    .filter((entry) => entry.upstream.length > 0 && upstream.differs(entry.commit, to, entry.upstream))
    .map((entry) => ({ entry, commits: upstream.commitsTouching(entry.commit, to, entry.upstream) }));

// Why these entries can't be marked caught up with upstream at `to`: one isn't mapped, an upstream
// path is gone there (find where it moved and map that), or a copy doesn't match it yet.
export function syncProblems(root: string, upstream: UpstreamCheckout, entries: ReadonlyArray<Entry>, paths: ReadonlyArray<string>, to: string) {
  return paths.flatMap((path) => {
    const entry = entries.find((candidate) => candidate.path === path);
    if (entry === undefined) return [`${path}: not in the map`];
    const gone = entry.upstream.filter((from) => !upstream.has(to, from));
    if (gone.length > 0) return gone.map((from) => `${path}: upstream ${from} doesn't exist at ${to.slice(0, 7)}`);
    const [from = path] = entry.upstream;
    return entry.relation === "copied" && !readFileSync(join(root, path)).equals(upstream.read(to, from))
      ? [`${path}: doesn't match upstream at ${to.slice(0, 7)} yet; copy ${from} over first`]
      : [];
  });
}
