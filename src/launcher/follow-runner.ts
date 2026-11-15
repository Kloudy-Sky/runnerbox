import { spawn } from "node:child_process";
import { sshArgs, type Vm } from "../vm/run-in-vm.ts";
import { shellQuote } from "./docker-command.ts";

// Reads a job container's output from Docker's own log, over a second SSH connection that only
// reads. The runner's output still goes straight to Runnerbox's stdout as it always did, so this
// can never hold up or end a job: if Runnerbox stops, only the reader ends. It waits up to 30
// seconds for the container to exist, and ends when the container does. Returns a stop function.
export function followRunnerOutput({ vm, container, onLine, sshBinary = "ssh" }: { vm: Vm; container: string; onLine: (line: string) => void; sshBinary?: string }) {
  const name = shellQuote(container);
  const command = `for _ in $(seq 1 30); do docker logs -f ${name} 2>/dev/null && exit 0; sleep 1; done`;
  const child = spawn(sshBinary, ["-o", "ConnectTimeout=10", ...sshArgs(vm, command)], { stdio: ["ignore", "pipe", "ignore"] });
  let stopped = false;
  let partial = "";
  // Decoded as a stream, so a character split across two chunks arrives whole.
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text: string) => {
    if (stopped) return;
    const lines = (partial + text).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) {
      try {
        onLine(line);
      } catch {}
    }
  });
  child.on("error", () => {});
  return () => {
    stopped = true;
    child.kill();
  };
}
