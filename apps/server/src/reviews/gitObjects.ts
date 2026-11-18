import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";

// The reviewed code, read as git objects from a bare repository on the server's machine. Nothing is
// ever checked out, so no file of the pull request is on disk as a file, and nothing in it runs: no
// hooks, no filters, no submodules. Every argument that reaches `git` here is either fixed, a
// 40-character commit ID, or comes after `--` or `-e`.

export const COMMIT_ID = /^[0-9a-f]{40}$/;
const FETCH_TIMEOUT_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 20_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_LIST_BYTES = 32 * 1024 * 1024;
export const MAX_READ_LINES = 800;
const MAX_LINE_CHARS = 2000;
const MAX_MATCHES = 200;
const MAX_LISTED = 500;

export type GitResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly why: string };
const fine = <A>(value: A): GitResult<A> => ({ ok: true, value });
const failed = (why: string): GitResult<never> => ({ ok: false, why });

// The owner's and the system's git config are never read, and git never stops to ask for a password.
const baseEnv = () => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
});

type Ran = { readonly code: number | "timeout" | "missing" | "too_big"; readonly stdout: string; readonly stderr: string };
// `signal` ends the process when the review it works for is stopped, so no git outlives its review
// holding the repository's locks or the token.
type GitOptions = { readonly signal?: AbortSignal | undefined; readonly env?: Record<string, string>; readonly timeoutMs?: number; readonly maxBytes?: number };
const git = (cwd: string, args: ReadonlyArray<string>, options: GitOptions = {}) =>
  new Promise<Ran>((resolve) => {
    // Node still starts a process for a signal that has already fired, and kills it a moment
    // later, so a slow machine could let that git run. A stopped review starts none.
    if (options.signal?.aborted) return resolve({ code: -1, stdout: "", stderr: "" });
    execFile("git", args, { cwd, env: { ...baseEnv(), ...options.env }, timeout: options.timeoutMs ?? READ_TIMEOUT_MS, maxBuffer: options.maxBytes ?? MAX_FILE_BYTES, encoding: "utf8", ...(options.signal ? { signal: options.signal } : {}) }, (error, stdout, stderr) => {
      if (error === null) return resolve({ code: 0, stdout, stderr });
      if (error.code === "ENOENT") return resolve({ code: "missing", stdout, stderr });
      if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolve({ code: "too_big", stdout, stderr });
      if (error.killed) return resolve({ code: "timeout", stdout, stderr });
      resolve({ code: typeof error.code === "number" ? error.code : -1, stdout, stderr });
    });
  });

// Brings one commit of each ID into the bare repository at `dir`, without history. The token goes to
// git in its environment, as a header for that one host, so it is in no argument, file or URL, and a
// redirect is never followed with it.
export async function fetchCommits(dir: string, remote: string, token: string | null, commits: ReadonlyArray<string>, signal?: AbortSignal): Promise<GitResult<void>> {
  if (!commits.every((commit) => COMMIT_ID.test(commit))) return failed("GitHub gave a commit ID that isn't one.");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const made = await git(dir, ["init", "--quiet", "--bare", "."], { signal });
  if (made.code === "missing") return failed("git isn't installed on the server's machine.");
  if (made.code !== 0) return failed("Couldn't make a place for the code on the server.");
  // The token is only ever sent over HTTPS, to that one host.
  const auth: Record<string, string> =
    token === null || !remote.startsWith("https://")
      ? {}
      : {
          GIT_CONFIG_COUNT: "2",
          GIT_CONFIG_KEY_0: `http.${new URL(remote).origin}/.extraHeader`,
          GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
          GIT_CONFIG_KEY_1: "http.followRedirects",
          GIT_CONFIG_VALUE_1: "false",
        };
  // Each commit is kept under a ref of its own, so git's housekeeping never removes one a stored review points at.
  const fetched = await git(dir, ["fetch", "--quiet", "--depth=1", "--no-tags", "--no-recurse-submodules", remote, ...commits.map((commit) => `+${commit}:refs/reviewed/${commit}`)], { signal, env: auth, timeoutMs: FETCH_TIMEOUT_MS });
  if (fetched.code === "timeout") return failed("Fetching the code from GitHub took too long.");
  return fetched.code === 0 ? fine(undefined) : failed("Couldn't fetch the code from GitHub.");
}

export type FileLines = { readonly path: string; readonly from: number; readonly to: number; readonly total: number; readonly lines: ReadonlyArray<{ readonly line: number; readonly text: string }> };

// Lines `from` to `to` of one file at one commit, at most MAX_READ_LINES of them.
export async function readLines(dir: string, commit: string, path: string, from: number, to: number, signal?: AbortSignal): Promise<GitResult<FileLines>> {
  if (!COMMIT_ID.test(commit) || path.includes("\0")) return failed("That isn't a path in the repository.");
  const shown = await git(dir, ["cat-file", "blob", `${commit}:${path}`], { signal });
  if (shown.code === "too_big") return failed("That file is too big to read.");
  if (shown.code !== 0) return failed(`No file at ${path} in this commit. Use list_files to find it.`);
  if (shown.stdout.slice(0, 8000).includes("\0")) return failed("That file isn't text.");
  const all = shown.stdout.split("\n");
  if (all.at(-1) === "") all.pop();
  const first = Math.max(1, from);
  const last = Math.min(all.length, to, first + MAX_READ_LINES - 1);
  return fine({ path, from: first, to: last, total: all.length, lines: all.slice(first - 1, last).map((text, index) => ({ line: first + index, text: text.slice(0, MAX_LINE_CHARS) })) });
}

export type Matches = { readonly matches: ReadonlyArray<{ readonly path: string; readonly line: number; readonly text: string }>; readonly more: boolean };

// Lines matching a POSIX extended regular expression at one commit, in text files, optionally only
// in paths matching a glob.
export async function searchLines(dir: string, commit: string, pattern: string, options: { readonly glob?: string | undefined; readonly ignoreCase?: boolean | undefined }, signal?: AbortSignal): Promise<GitResult<Matches>> {
  if (!COMMIT_ID.test(commit) || pattern.includes("\0") || options.glob?.includes("\0")) return failed("That isn't a pattern git can search for.");
  const found = await git(dir, ["grep", "--no-color", "-n", "-I", "-E", ...(options.ignoreCase ? ["-i"] : []), "-e", pattern, commit, "--", ...(options.glob === undefined ? [] : [`:(glob)${options.glob}`])], { signal, maxBytes: MAX_LIST_BYTES });
  if (found.code === "timeout") return failed("That search took too long. Narrow it with a glob.");
  if (found.code === "too_big") return failed("That search matches too much. Narrow the pattern or add a glob.");
  // git grep exits 1 when nothing matches.
  if (found.code === 1 && found.stderr.trim() === "") return fine({ matches: [], more: false });
  if (found.code !== 0) return failed("git couldn't run that search. The pattern is a POSIX extended regular expression.");
  const rows = found.stdout.split("\n").filter(Boolean);
  const matches = rows.slice(0, MAX_MATCHES).flatMap((row) => {
    // `<commit>:<path>:<line>:<text>`. A path holding ":<digits>:" would split early; such a row is dropped.
    const match = /^[0-9a-f]{40}:(.+?):(\d+):(.*)$/.exec(row);
    return match ? [{ path: match[1]!, line: Number(match[2]), text: match[3]!.slice(0, 400) }] : [];
  });
  return fine({ matches, more: rows.length > MAX_MATCHES });
}

// `**` crosses directories, `*` and `?` stay inside one name. Everything else is literal.
const globPattern = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*")}$`);

export type Listed = { readonly paths: ReadonlyArray<string>; readonly more: number };

// The paths of every file at one commit, or only those matching a glob.
export async function listPaths(dir: string, commit: string, glob: string | undefined, signal?: AbortSignal): Promise<GitResult<Listed>> {
  if (!COMMIT_ID.test(commit)) return failed("That isn't a commit.");
  const listed = await git(dir, ["ls-tree", "-r", "-z", "--name-only", commit], { signal, maxBytes: MAX_LIST_BYTES });
  if (listed.code !== 0) return failed("Couldn't list the files in this commit.");
  const wanted = glob === undefined ? null : globPattern(glob);
  const paths = listed.stdout.split("\0").filter((path) => path !== "" && (wanted === null || wanted.test(path)));
  return fine({ paths: paths.slice(0, MAX_LISTED), more: Math.max(0, paths.length - MAX_LISTED) });
}
