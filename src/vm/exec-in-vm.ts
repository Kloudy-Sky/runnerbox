import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { sshArgs, type Vm } from "./run-in-vm.ts";

export type VmExec = { exitCode: number | null; output: string; truncated: boolean; timedOut: boolean };

type ExecInVm = {
  vm: Vm;
  // Fixed text with only checked names in it. Anything from outside goes in `input`, as data.
  command: string;
  input?: string | Readable;
  timeoutMs: number;
  // Only the last this many bytes of stdout and stderr together are kept.
  maxOutput: number;
  sshBinary?: string;
};

// Runs a command over SSH with `input` on stdin, and returns its exit code and the end of its
// output. SSH is killed after `timeoutMs`; the command should bound itself too, since that doesn't
// reach a process inside a container.
export function execInVm({ vm, command, input = "", timeoutMs, maxOutput, sshBinary = "ssh" }: ExecInVm) {
  return new Promise<VmExec>((resolve) => {
    const child = spawn(sshBinary, ["-o", "ConnectTimeout=10", ...sshArgs(vm, command)], { stdio: ["pipe", "pipe", "pipe"] });
    let kept = Buffer.alloc(0);
    let truncated = false;
    const keep = (chunk: Buffer) => {
      kept = Buffer.concat([kept, chunk]);
      if (kept.length > maxOutput) {
        truncated = true;
        kept = kept.subarray(kept.length - maxOutput);
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode, output: kept.toString("utf8"), truncated, timedOut });
    };
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
    child.stdin.on("error", () => {});
    if (typeof input === "string") child.stdin.end(input);
    else {
      input.on("error", () => child.kill("SIGKILL"));
      input.pipe(child.stdin);
    }
  });
}
