// Reads docs/t3code-map.json: every runnerbox file taken from T3 Code, and how. `pnpm t3code-diff`
// and the map's test both start here.
import { readFileSync } from "node:fs";
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

export const loadMap = (root: string) => parseMap(JSON.parse(readFileSync(join(root, MAP_PATH), "utf8")));
