import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { changedUpstream, editedCopies, localProblems } from "./check.ts";
import { loadMap, parseMap } from "./map.ts";
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

test("an edited copy is caught, and an adapted one may differ", (t) => {
  const upstream = repo(t, { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 1;\n", "c.ts": "export const c = 1;\n" });
  const local = repo(t, { "a.ts": "export const a = 1;\n", "b.ts": "export const b = 2;\n", "c.ts": "// runnerbox: cut\n" });
  const entries = mapAt(upstream.first, { "a.ts": { relation: "copied" }, "b.ts": { relation: "copied" }, "c.ts": { relation: "adapted" } });

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

  assert.deepEqual(
    changedUpstream(upstreamCheckout(upstream.dir), entries, second).map(({ entry, commits }) => [entry.path, commits]),
    [["a.ts", 1]],
  );
});

test("a stand-in must be both marked and mapped, and an adapted file must mark its cuts", (t) => {
  const local = repo(t, {
    "marked.ts": "// A stand-in of runnerbox's, not T3 Code's file.\n",
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
