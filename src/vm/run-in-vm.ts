import { execFile } from "node:child_process";
import type { VmInstall } from "../launcher/launcher-config.ts";
import { runWithSecret } from "../launcher/run-with-secret.ts";

type Vm = VmInstall["vm"];

type VmCommand = {
  vm: Vm;
  command: string;
  // Sent over stdin, because arguments are visible to other processes on both machines.
  secret: string;
  sshBinary?: string;
};

export function sshArgs(vm: Vm, command: string) {
  return [
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
}

// Runs a command over SSH until it ends, and returns its exit code. Null means SSH itself couldn't
// start or was killed. Ending SSH doesn't stop a container the command started.
export const runInVm = ({ vm, command, secret, sshBinary = "ssh" }: VmCommand) =>
  runWithSecret(sshBinary, sshArgs(vm, command), secret);

// Runs a short command over SSH and returns its stdout. Fails if it exits non-zero or takes over
// 20 seconds, so a hung VM can't stall a slot.
export function readFromVm({ vm, command, sshBinary = "ssh" }: Omit<VmCommand, "secret">) {
  return new Promise<string>((resolve, reject) => {
    execFile(sshBinary, ["-o", "ConnectTimeout=10", ...sshArgs(vm, command)], { timeout: 20_000 }, (error, stdout) =>
      error ? reject(new Error(`ssh ${command} failed: ${error.message.split("\n")[0]}`)) : resolve(stdout),
    );
  });
}
