import { spawn } from "node:child_process";
import { SUPERVISED_ENV } from "./protocol.ts";

export type PreflightInput = {
  readonly node: string;
  readonly nodeArgs: ReadonlyArray<string>;
  readonly staged: string;
  readonly file: string;
  readonly version: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
};

type Run = { readonly code: number | null; readonly stdout: string; readonly stderr: string; readonly timedOut: boolean };

const run = (input: PreflightInput, args: ReadonlyArray<string>) =>
  new Promise<Run>((resolve) => {
    const { [SUPERVISED_ENV]: _, ...env } = input.env;
    const child = spawn(input.node, [...input.nodeArgs, input.staged, ...args], { env, stdio: ["ignore", "pipe", "pipe"], signal: input.signal });
    let [stdout, stderr, timedOut] = ["", "", false];
    child.stdout.on("data", (chunk: Buffer) => (stdout = (stdout + chunk.toString()).slice(-4096)));
    child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4096)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, input.timeoutMs);
    child.once("error", () => undefined);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });

export const lastLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1)
    ?.slice(0, 300) ?? "";

const failure = (result: Run, what: string) =>
  result.timedOut ? `${what} didn't finish within the time allowed.` : lastLine(result.stderr) || `${what} stopped with code ${result.code}.`;

// Whether a download runs on this machine, asked while the old server still serves: it must
// print its own version, and its supervisor must read this install's update record. Null when it
// passes, or what went wrong in a line.
export async function preflight(input: PreflightInput): Promise<string | null> {
  const version = await run(input, ["--version"]);
  if (version.code !== 0 || version.timedOut) return failure(version, "Asking its version");
  const printed = version.stdout.trim().split(/\s+/)[0] ?? "";
  if (printed !== input.version) return `It says it's version ${printed || "nothing"}, not ${input.version}.`;
  const check = await run(input, ["serve", `--check-supervisor=${input.file}`]);
  if (check.code !== 0 || check.timedOut || check.stdout.trim() !== "ok") return failure(check, "Checking its supervisor");
  return null;
}
