import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { type } from "arktype";
import { distinctJobs, JobRecord } from "./job-record.ts";

// The log lives outside any checkout because job and branch names can be private.
export function defaultLogPath(repo: string) {
  // The XDG spec says to ignore relative paths, which could also land inside a checkout.
  const configured = process.env.XDG_STATE_HOME;
  const stateHome = configured && isAbsolute(configured) ? configured : join(homedir(), ".local", "state");
  return join(stateHome, "runnerbox", `${repo.replace("/", "__")}.ndjson`);
}

export function createJobLog(path: string) {
  return {
    path,

    async read() {
      const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });

      const records: JobRecord[] = [];
      let skipped = 0;
      for (const line of text.split("\n")) {
        if (!line) continue;
        const parsed = parseLine(line);
        if (parsed) records.push(parsed);
        else skipped++;
      }
      if (skipped > 0) {
        console.error(`Warning: skipped ${skipped} unreadable lines. Jobs may be missing, so delete ${path} to rebuild it.`);
      }
      return distinctJobs(records);
    },

    async append(records: readonly JobRecord[]) {
      if (records.length === 0) return;
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
      await appendFile(path, lines, { mode: 0o600 });
    },
  };
}

function parseLine(line: string) {
  try {
    const parsed = JobRecord(JSON.parse(line));
    return parsed instanceof type.errors ? null : parsed;
  } catch {
    return null;
  }
}
