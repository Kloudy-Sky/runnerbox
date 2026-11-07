import { spawn } from "node:child_process";
import type { LauncherConfig } from "../launcher/launcher-config.ts";

type VmCommand = {
  vm: LauncherConfig["vm"];
  command: string;
  // Sent over stdin, because arguments are visible to other processes on both machines.
  secret: string;
  sshBinary?: string;
};

// Runs a command over SSH until it ends, and returns its exit code. Null means SSH itself couldn't
// start or was killed. Output goes to this process's own stdout and stderr.
export function runInVm({ vm, command, secret, sshBinary = "ssh" }: VmCommand) {
  const args = [
    "-i", vm.keyFile,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${vm.knownHostsFile}`,
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=4",
    vm.host,
    command,
  ];

  return new Promise<number | null>((resolve) => {
    const ssh = spawn(sshBinary, args, { stdio: ["pipe", "inherit", "inherit"] });
    ssh.on("error", () => resolve(null));
    ssh.on("close", (code) => resolve(code));
    // If SSH dies before reading this, the close event above still reports it.
    ssh.stdin.on("error", () => {});
    ssh.stdin.end(`${secret}\n`);
  });
}
