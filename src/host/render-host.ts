import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostInstall } from "../launcher/launcher-config.ts";
import { jobScript } from "./job-script.ts";
import { jobStartedHook } from "./job-started-hook.ts";
import { pfRules } from "./pf-rules.ts";
import { setupScript } from "./setup-script.ts";

// Writes what a host install needs on its machine into `outDir`. Nothing changes until you run setup.sh.
export async function renderHost(config: HostInstall, outDir: string) {
  const allowedWorkflows = config.runners[0]?.allowedWorkflows;
  const files = {
    "setup.sh": setupScript(config),
    "run-job": jobScript(config),
    "pf.rules": pfRules(config),
    ...(allowedWorkflows ? { "job-started": jobStartedHook(allowedWorkflows) } : {}),
  };
  await mkdir(outDir, { recursive: true });
  for (const [path, contents] of Object.entries(files)) await writeFile(join(outDir, path), contents);
  await chmod(join(outDir, "setup.sh"), 0o755);
  return Object.keys(files);
}
