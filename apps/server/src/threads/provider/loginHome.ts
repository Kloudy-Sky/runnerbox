import { homedir } from "node:os";
import { join } from "node:path";

// An owner's CLI home as typed in Settings (`~`, `~/.codex` or an absolute path), made absolute
// against the server user's home, after T3 Code's Codex home path setting.
export const expandLoginHome = (typed: string) => (typed === "~" ? homedir() : typed.startsWith("~/") ? join(homedir(), typed.slice(2)) : typed);
