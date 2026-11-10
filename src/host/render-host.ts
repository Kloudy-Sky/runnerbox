import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostInstall } from "../launcher/launcher-config.ts";
import { jobScript } from "./job-script.ts";
import { jobStartedHook } from "./job-started-hook.ts";
import { pfRules } from "./pf-rules.ts";
import { setupScript } from "./setup-script.ts";
import { windowsJobStartedHook } from "./windows-hook.ts";
import { windowsJobScript } from "./windows-job-script.ts";
import { windowsRunnerScript } from "./windows-runner-script.ts";
import { windowsSetupScript } from "./windows-setup-script.ts";

// Writes what a host install needs on its machine into `outDir`. Nothing changes until you run the
// setup script. The files are for the OS this runs on, because that's the machine they set up.
export async function renderHost(config: HostInstall, outDir: string, platform: string = process.platform) {
  const allowedWorkflows = config.runners[0]?.allowedWorkflows;
  if (platform !== "darwin" && platform !== "win32") throw new Error("A host install runs on macOS or Windows. On Linux, use a VM install.");
  const files: Record<string, string> =
    platform === "darwin"
      ? {
          "setup.sh": setupScript(config),
          "run-job": jobScript(config),
          "pf.rules": pfRules(config),
          ...(allowedWorkflows ? { "job-started.sh": jobStartedHook(allowedWorkflows) } : {}),
        }
      : {
          "setup.ps1": windowsSetupScript(config),
          "run-job.ps1": windowsJobScript(config),
          "job.ps1": windowsRunnerScript(config),
          ...(allowedWorkflows ? { "job-started.ps1": windowsJobStartedHook(allowedWorkflows) } : {}),
        };
  await mkdir(outDir, { recursive: true });
  for (const [path, contents] of Object.entries(files)) await writeFile(join(outDir, path), contents);
  if (platform === "darwin") await chmod(join(outDir, "setup.sh"), 0o755);
  return Object.keys(files);
}
