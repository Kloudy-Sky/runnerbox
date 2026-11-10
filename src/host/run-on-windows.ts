import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import type { HostInstall } from "../launcher/launcher-config.ts";
import { windowsPaths } from "./windows-paths.ts";

const POLL_MS = 2_000;
const run = promisify(execFile);

// Runs one job on a Windows host and returns its exit code, or null if the task couldn't run. A
// scheduled task has no stdin, so the registration waits in a folder only the owner and SYSTEM can
// open, and the task deletes it as it starts. The task always ends by writing a result.
export async function runOnWindowsHost(config: Pick<HostInstall, "name">, registration: string) {
  const { registration: registrationFile, result, runTask } = windowsPaths(config);
  const taskRunning = async () => (await run("schtasks", ["/query", "/tn", runTask, "/fo", "csv", "/nh"])).stdout.includes("Running");
  try {
    await rm(result, { force: true });
    await writeFile(registrationFile, registration);
    await run("schtasks", ["/run", "/tn", runTask]);
    // A task that stopped without a result was killed, as at shutdown. Twice, because it can take
    // a moment to show as running.
    for (let idle = 0; idle < 2; ) {
      await wait(POLL_MS);
      const code = await readFile(result, "utf8").catch(() => null);
      if (code !== null) return Number(code.trim());
      idle = (await taskRunning()) ? 0 : idle + 1;
    }
    return null;
  } catch (error) {
    console.log(`couldn't run ${runTask}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
