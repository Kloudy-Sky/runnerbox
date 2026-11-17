// Reads docs/t3code-map.json: every runnerbox file taken from T3 Code, and how. `pnpm t3code-diff`
// and the map's test both start here.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type } from "arktype";

// The line at the top of every stand-in, which the map's test matches against its stand-ins.
export const STAND_IN_MARKER = "A stand-in of runnerbox's";
// The line that marks each cut in an adapted copy.
export const CUT_MARKER = "// runnerbox:";

const Commit = type("/^[0-9a-f]{40}$/");
const Path = type("/^[\\w.@\\/-]+$/");

// A copy is one file from one file, so it can be compared byte for byte. `upstream` defaults to the
// same path, since both repositories keep the web app in apps/web/src.
const Copy = type({
  "+": "reject",
  relation: "'copied' | 'adapted'",
  "upstream?": Path,
  "commit?": Commit,
  "note?": "string",
});

// A file written after T3 Code, or standing in for a module the copies import. Either side may be a
// directory. `null` is a stand-in for something outside T3 Code, with nothing upstream to watch.
const Derived = type({
  "+": "reject",
  relation: "'follows' | 'stand-in'",
  "upstream?": Path.or(Path.array().atLeastLength(1)).or("null"),
  "commit?": Commit,
  "note?": "string",
});

const T3codeMap = type({
  "+": "reject",
  repository: "string",
  commit: Commit,
  files: { "+": "reject", "[/^[\\w.@\\/-]+$/]": Copy.or(Derived) },
});

export type Relation = (typeof Copy.infer | typeof Derived.infer)["relation"];

// One entry with its defaults filled in.
export type Entry = {
  path: string;
  relation: Relation;
  upstream: ReadonlyArray<string>;
  commit: string;
  note: string | undefined;
};

export const MAP_PATH = "docs/t3code-map.json";

// Throws, naming the problem, when the map doesn't match its schema.
export function parseMap(json: unknown) {
  const map = T3codeMap.assert(json);
  const entries: Entry[] = Object.entries(map.files).map(([path, entry]) => ({
    path,
    relation: entry.relation,
    upstream: entry.upstream === null ? [] : [entry.upstream ?? path].flat(),
    commit: entry.commit ?? map.commit,
    note: entry.note,
  }));
  return { repository: map.repository, commit: map.commit, entries };
}

const readMap = (root: string) => T3codeMap.assert(JSON.parse(readFileSync(join(root, MAP_PATH), "utf8")));

export const loadMap = (root: string) => parseMap(readMap(root));

// One entry per line, so the map reads as a list and a sync changes one line per file.
const format = (map: typeof T3codeMap.infer) =>
  [
    "{",
    `  "repository": ${JSON.stringify(map.repository)},`,
    `  "commit": ${JSON.stringify(map.commit)},`,
    '  "files": {',
    Object.entries(map.files)
      .map(([path, entry]) => `    ${JSON.stringify(path)}: ${JSON.stringify(entry)}`)
      .join(",\n"),
    "  }",
    "}",
    "",
  ].join("\n");

// Records that these entries are caught up with upstream at `to`, so the next diff starts there.
export function markSynced(root: string, paths: ReadonlyArray<string>, to: string) {
  const map = readMap(root);
  const files = Object.fromEntries(
    Object.entries(map.files).map(([path, entry]) => {
      if (!paths.includes(path)) return [path, entry];
      const { commit: _, ...rest } = entry;
      return [path, to === map.commit ? rest : { ...rest, commit: to }];
    }),
  );
  writeFileSync(join(root, MAP_PATH), format({ ...map, files }));
}
