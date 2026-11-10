import { spawn } from "node:child_process";

// Runs one virsh command against the host's system libvirt and returns its stdout. `stdin` feeds
// commands told to read /dev/stdin, so XML never touches disk. There's no timeout, because copying
// a disk takes minutes.
export function virsh(args: string[], stdin = "", binary = "virsh") {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, ["--connect", "qemu:///system", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => reject(new Error(`virsh ${args[0]} couldn't start: ${error.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`virsh ${args[0]} failed: ${stderr.trim().split("\n")[0]}`)),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}

export type Virsh = (args: string[], stdin?: string) => Promise<string>;
