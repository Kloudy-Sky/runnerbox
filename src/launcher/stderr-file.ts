import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { every } from "./every.ts";
import { createLastLine } from "./last-line.ts";

const MAX_BYTES = 10_000_000;
const CHECK_MS = 15_000;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Runs a command with its stderr in an owner-only file at `path`, which `up` opens and hands to it
// as a descriptor. Unlike a pipe, the command keeps writing to it whether or not `up` is alive, so
// nothing ties a job to `up`. Once the command ends, what it wrote is copied to `up`'s own stderr,
// the file is removed, and its last meaningful line comes back. If the file can't be opened, the
// command writes to `up`'s stderr directly and there's no line.
export async function withStderrFile<T>(path: string, run: (stderr: number | "inherit") => Promise<T>) {
  const file = await openFile(path).catch((error: unknown) => {
    console.error(`Couldn't open ${path}: ${message(error)}`);
    return null;
  });
  if (!file) return { result: await run("inherit"), lastLine: null };
  // Opened for appending, so emptying it leaves no gap where the command writes next.
  const stopChecking = every(CHECK_MS, async () => {
    if ((await file.stat()).size > MAX_BYTES) await file.truncate(0);
  });
  try {
    const result = await run(file.fd);
    return { result, lastLine: await lastLineOf(path) };
  } finally {
    stopChecking();
    await file.close().catch(() => {});
    await rm(path, { force: true }).catch(() => {});
  }
}

async function openFile(path: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // A file left by an `up` that died starts over. A command still writing to it keeps its own copy.
  await rm(path, { force: true });
  return open(path, "a", 0o600);
}

// Read by path, since the command's appends moved the descriptor's offset to the end.
async function lastLineOf(path: string) {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    console.error(`Couldn't read ${path}: ${message(error)}`);
    return "";
  });
  process.stderr.write(text);
  const lastLine = createLastLine();
  lastLine.push(text);
  return lastLine.last();
}
