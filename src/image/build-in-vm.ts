import { type ChildProcess, spawn } from "node:child_process";
import type { LauncherConfig } from "../launcher/launcher-config.ts";
import { shellQuote } from "../launcher/docker-command.ts";
import { sshArgs } from "../vm/run-in-vm.ts";

type Build = { vm: LauncherConfig["vm"]; context: string; tag: string; tarBinary?: string; sshBinary?: string };

const succeeded = (child: ChildProcess) =>
  new Promise<boolean>((resolve) => {
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });

// Streams the build context from the host into `docker build` in the VM, so the VM never needs a
// copy of the project. Build output goes to this process's stdout and stderr.
export async function buildInVm({ vm, context, tag, tarBinary = "tar", sshBinary = "ssh" }: Build) {
  const tar = spawn(tarBinary, ["-C", context, "-cf", "-", "."], { stdio: ["ignore", "pipe", "inherit"] });
  const ssh = spawn(sshBinary, sshArgs(vm, `docker build -t ${shellQuote(tag)} -`), {
    stdio: ["pipe", "inherit", "inherit"],
  });
  ssh.stdin.on("error", () => {});
  tar.stdout.pipe(ssh.stdin);
  // A tar that never started never ends the pipe, so end it here and let docker see a bad context.
  tar.on("error", () => ssh.stdin.end());

  const [tarOk, sshOk] = await Promise.all([succeeded(tar), succeeded(ssh)]);
  return tarOk && sshOk;
}
