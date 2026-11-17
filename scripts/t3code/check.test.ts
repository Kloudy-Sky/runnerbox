import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { changedUpstream, editedCopies, localProblems, syncProblems } from "./check.ts";
import { loadMap, MAP_PATH, markSynced, parseMap } from "./map.ts";
import { upstreamCheckout } from "./upstream.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

// A git repository holding `files`, committed, so it can stand in for either side.
function repo(t: TestContext, files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "runnerbox-t3code-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const commit = (contents: Record<string, string>) => {
    for (const [path, text] of Object.entries(contents)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    git("add", "-A");
    git("-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "change");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  return { dir, commit, first: commit(files) };
}

const mapAt = (commit: string, files: Record<string, unknown>) => parseMap({ repository: "https://example.com/t3code", commit, files }).entries;

test("the map matches this repository", () => {
  assert.deepEqual(localProblems(ROOT, loadMap(ROOT).entries), []);
});

test("an edited copy is caught, an adapted one may differ, and CRLF endings aren't an edit", (t) => {
  const upstream = repo(t, { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 1;\n", "c.ts": "export const c = 1;\n", "d.ts": "x\n" });
  const local = repo(t, { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n", "c.ts": "// runnerbox: cut\n", "d.ts": "x\r\n" });
  execFileSync("git", ["-C", local.dir, "config", "core.autocrlf", "true"]);
  const entries = mapAt(upstream.first, {
    "a.ts": { relation: "copied" },
    "b.ts": { relation: "copied" },
    "c.ts": { relation: "adapted" },
    "d.ts": { relation: "copied" },
  });

  assert.deepEqual(
    editedCopies(local.dir, upstreamCheckout(upstream.dir), entries).map((entry) => entry.path),
    ["b.ts"],
  );
});

test("only entries whose upstream moved since their own commit are listed", (t) => {
  const upstream = repo(t, { "a.ts": "1\n", "b.ts": "1\n", "c.ts": "1\n" });
  const second = upstream.commit({ "a.ts": "2\n", "c.ts": "2\n" });
  const entries = mapAt(upstream.first, {
    "a.ts": { relation: "copied" },
    "b.ts": { relation: "copied" },
    "c-after.ts": { relation: "follows", upstream: "c.ts", commit: second },
  });

  const changed = (to: string) => changedUpstream(upstreamCheckout(upstream.dir), entries, to).map(({ entry, commits }) => [entry.path, commits]);
  assert.deepEqual(changed(second), [["a.ts", 1]]);
  // A `to` older than an entry's commit isn't news about that entry.
  assert.deepEqual(changed(upstream.first), []);
});

test("a stand-in must be both marked and mapped, and an adapted file must mark its cuts", (t) => {
  const local = repo(t, {
    "marked.ts": "// A stand-in of runnerbox's.\n",
    "unmarked.ts": "export {};\n",
    "adapted.ts": "export {};\n",
  });
  const entries = mapAt("0".repeat(40), { "unmarked.ts": { relation: "stand-in" }, "adapted.ts": { relation: "adapted" }, "gone.ts": { relation: "copied" } });

  assert.deepEqual(localProblems(local.dir, entries), [
    "gone.ts: mapped, but not in runnerbox",
    "adapted.ts: adapted, but no `// runnerbox:` marks a cut",
    "marked.ts: marked as a stand-in, but not mapped as one",
    `unmarked.ts: mapped as a stand-in, but its first line doesn't say "A stand-in of runnerbox's"`,
  ]);
});

test("code that mentions T3 Code must be mapped, itself or by a directory around it", (t) => {
  const local = repo(t, {
    "after.ts": "// After T3 Code's sidebar.\n",
    "feature/inside.ts": "// As T3 Code does it.\n",
    "notes.md": "T3 Code, in prose.\n",
  });
  const entries = mapAt("0".repeat(40), { feature: { relation: "follows", upstream: "src/feature" } });

  assert.deepEqual(localProblems(local.dir, entries), ["after.ts: mentions T3 Code, but isn't mapped"]);
});

test("an entry is marked caught up only when upstream still has it and a copy matches it", (t) => {
  const upstream = repo(t, { "copy.ts": "1\n", "behind.ts": "1\n", "moved.ts": "1\n" });
  const second = upstream.commit({ "copy.ts": "2\n", "behind.ts": "2\n" });
  execFileSync("git", ["-C", upstream.dir, "mv", "moved.ts", "renamed.ts"]);
  const third = upstream.commit({});
  const local = repo(t, { "copy.ts": "2\n", "behind.ts": "1\n", "after.ts": "x\n" });
  const entries = mapAt(upstream.first, {
    "copy.ts": { relation: "copied" },
    "behind.ts": { relation: "copied" },
    "after.ts": { relation: "follows", upstream: "moved.ts" },
  });
  const checkout = upstreamCheckout(upstream.dir);

  assert.deepEqual(syncProblems(local.dir, checkout, entries, ["copy.ts", "after.ts"], second), []);
  assert.deepEqual(syncProblems(local.dir, checkout, entries, ["behind.ts", "after.ts", "nope.ts"], third), [
    `behind.ts: doesn't match upstream at ${third.slice(0, 7)} yet; copy behind.ts over first`,
    `after.ts: upstream moved.ts doesn't exist at ${third.slice(0, 7)}`,
    "nope.ts: not in the map",
  ]);
});

test("marking an entry caught up moves only its commit, and drops it when it's the map's own", (t) => {
  const first = "1".repeat(40);
  const later = "2".repeat(40);
  const local = repo(t, {
    [MAP_PATH]: JSON.stringify({
      repository: "https://example.com/t3code",
      commit: first,
      files: { "a.ts": { relation: "copied" }, "b.ts": { relation: "copied" }, "c.ts": { relation: "follows", commit: later } },
    }),
  });

  markSynced(local.dir, ["a.ts", "c.ts"], later);
  assert.deepEqual(
    loadMap(local.dir).entries.map(({ path, commit }) => [path, commit]),
    [["a.ts", later], ["b.ts", first], ["c.ts", later]],
  );
  markSynced(local.dir, ["a.ts", "c.ts"], first);
  assert.deepEqual(JSON.parse(readFileSync(join(local.dir, MAP_PATH), "utf8")).files, {
    "a.ts": { relation: "copied" },
    "b.ts": { relation: "copied" },
    "c.ts": { relation: "follows" },
  });
});
