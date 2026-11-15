import { homedir } from "node:os";
import { join } from "node:path";

// An owner's CLI home as typed in Settings (`~`, `~/.codex` or an absolute path), made absolute
// against the server user's home, after T3 Code's Codex home path setting.
export const expandLoginHome = (typed: string) => (typed === "~" ? homedir() : typed.startsWith("~/") ? join(homedir(), typed.slice(2)) : typed);

// Why an owner's home isn't safe to point a CLI at, or null when it is: it must be a directory the
// server's own user owns, that no group or other user can write, since its config decides much of
// what the CLI does, and another user could otherwise plant one.
export function loginHomeProblem(home: string, info: { readonly isDirectory: boolean; readonly uid: number; readonly mode: number } | null, uid: number) {
  if (info === null || !info.isDirectory) return `There's no home at ${home}.`;
  if (info.uid !== uid) return `Runnerbox won't use ${home}: it belongs to another user.`;
  if ((info.mode & 0o022) !== 0) return `Runnerbox won't use ${home}: other users can write to it.`;
  return null;
}
