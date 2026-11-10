import type { HostInstall } from "../launcher/launcher-config.ts";

// A PowerShell single-quoted string, where the only special character is the quote itself.
export function psQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

// Where a Windows host install keeps its files, and what its scheduled tasks are called. Program
// Files is writable by administrators only, so the job user can read the scripts but not change them.
export function windowsPaths({ name }: Pick<HostInstall, "name">) {
  const dir = `C:\\Program Files\\runnerbox\\${name}`;
  // Only the owner and SYSTEM can open this folder: the registration waits here for the job task.
  const spool = `${dir}\\spool`;
  // The job user's side: it reads the registration here, and leaves its log and exit code.
  const handoff = `${dir}\\handoff`;
  return {
    dir,
    spool,
    handoff,
    registration: `${spool}\\registration`,
    result: `${spool}\\result`,
    // Runs as SYSTEM, started by the owner: it runs one job and cleans up around it.
    runTask: `runnerbox-${name}`,
    // Runs the runner itself, as the job user. Only the task above starts it.
    jobTask: `runnerbox-${name}-job`,
    runJob: `${dir}\\run-job.ps1`,
    job: `${dir}\\job.ps1`,
    jobStarted: `${dir}\\job-started.ps1`,
    runnerArchive: `${dir}\\actions-runner.zip`,
    firewallGroup: `runnerbox-${name}`,
  };
}
