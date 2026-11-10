import { spawn } from "node:child_process";

// Runs a command until it ends and returns its exit code. Null means it couldn't start or was
// killed. The secret goes in on stdin, because arguments are visible to other processes. Output
// goes to this process's own stdout and stderr.
export function runWithSecret(binary: string, args: string[], secret: string) {
  return new Promise<number | null>((resolve) => {
    // Its own process group, so a terminal's Ctrl-C reaches only `up`, which drains, and doesn't cut
    // off a busy job.
    const child = spawn(binary, args, { stdio: ["pipe", "inherit", "inherit"], detached: true });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
    // If the command dies before reading this, the close event above still reports it.
    child.stdin.on("error", () => {});
    child.stdin.end(`${secret}\n`);
  });
}
