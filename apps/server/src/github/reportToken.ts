import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Where the report timer keeps its read-only GitHub token: `$XDG_CONFIG_HOME/runnerbox/report.env`,
// one line `GITHUB_TOKEN=...`, as deploy/runnerbox-report@.service reads it.
export const reportEnvPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "runnerbox", "report.env");

// The token, or why it can't be used. Like the core's token file, it's refused unless it belongs
// to the user running this process and no one else can read or write it. The value is returned
// for one call and never logged.
export async function readReportToken(path: string): Promise<{ token: string } | { refused: string }> {
  const info = await stat(path).catch(() => null);
  if (!info) return { refused: `${path} doesn't exist` };
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) return { refused: `${path} belongs to another user` };
  if ((info.mode & 0o077) !== 0) return { refused: `${path} must be readable only by its owner (chmod 600)` };
  const text = await readFile(path, "utf8").catch(() => "");
  const line = text.split("\n").find((each) => /^\s*(export\s+)?GITHUB_TOKEN\s*=/.test(each));
  const token = line?.slice(line.indexOf("=") + 1).trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
  return token ? { token } : { refused: `${path} has no GITHUB_TOKEN` };
}
