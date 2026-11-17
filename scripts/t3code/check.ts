// What `pnpm t3code-diff` reports: the map's own problems, copies that were edited, and the entries
// whose upstream files moved on since they were taken.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CUT_MARKER, STAND_IN_MARKER, type Entry } from "./map.ts";
import type { UpstreamCheckout } from "./upstream.ts";

const firstLine = (root: string, path: string) => readFileSync(join(root, path), "utf8").split("\n", 1)[0] ?? "";

// Files whose first line marks them as stand-ins, tracked or not.
const markedStandIns = (root: string) =>
  execFileSync("git", ["-C", root, "grep", "-l", "--untracked", "-F", STAND_IN_MARKER], { encoding: "utf8" })
    .split("\n")
    .filter((path) => path !== "" && firstLine(root, path).includes(STAND_IN_MARKER));

// Problems found without T3 Code: a mapped path that isn't here, an adapted file with no cut marked,
// and a stand-in that's marked but not mapped, or mapped but not marked.
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
