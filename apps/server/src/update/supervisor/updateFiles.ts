import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readdir, readFile, rename, rm, stat, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "./protocol.ts";

// Where an update keeps its files, beside the runnerbox.js the service manager runs:
//   .runnerbox-update/<version>.js   a checked download, until it's put in place or dropped
//   .runnerbox-update/update.json    the last update and how it ended
//   runnerbox.js.previous            the file the last update replaced, to go back to by hand
export const updatePaths = (file: string) => {
  const dir = join(dirname(file), ".runnerbox-update");
  return { dir, record: join(dir, "update.json"), staged: (version: string) => join(dir, `${version}.js`), previous: `${file}.previous` };
};

// `pending` from just before the old server stops until the new one is in place or the old one is
// back. Written only by the supervisor; the server reads it to tell the app how an update ended.
export type UpdateRecord = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly sha256: string;
  readonly status: "pending" | "committed" | "rolled-back";
  readonly reason?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
};

export const newUpdateId = () => randomBytes(8).toString("hex");

export async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const isUpdateRecord = (value: unknown): value is UpdateRecord =>
  isRecord(value) &&
  ["id", "from", "to", "sha256", "startedAt"].every((key) => typeof value[key] === "string") &&
  (value.status === "pending" || value.status === "committed" || value.status === "rolled-back");

// Null when there's none, or it can't be read: runnerbox.js itself is always whole, so a lost
// record only loses how the last update ended.
export async function readRecord(path: string): Promise<UpdateRecord | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isUpdateRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function syncPath(path: string) {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// On disk before this returns, whatever happens to the machine next.
export async function writeRecord(path: string, record: UpdateRecord) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(record));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
  await syncPath(dirname(path));
}

// Keeps a copy of `file` as the previous version. With `putInPlace` after it, each step leaves
// `file` whole: the old version until the rename, the new one after it.
export async function keepPrevious(file: string) {
  const { previous } = updatePaths(file);
  await copyFile(file, previous);
  await syncPath(previous);
}

// Moves `staged` over `file`, with the mode `file` had.
export async function putInPlace(staged: string, file: string) {
  await chmod(staged, (await stat(file)).mode & 0o7777);
  await rename(staged, file);
  await syncPath(dirname(file));
}

// What a pending record means once the supervisor starts again: the new file is in place exactly
// when runnerbox.js has its checksum, because it's renamed there only after it was ready.
export async function settle(file: string, now = () => new Date().toISOString()): Promise<UpdateRecord | null> {
  const paths = updatePaths(file);
  const record = await readRecord(paths.record);
  if (record?.status === "pending") {
    const inPlace = (await sha256File(file)) === record.sha256;
    const settled: UpdateRecord = inPlace
      ? { ...record, status: "committed", finishedAt: now() }
      : { ...record, status: "rolled-back", reason: "The server stopped in the middle of the update.", finishedAt: now() };
    await writeRecord(paths.record, settled);
    await dropDownloads(file);
    return settled;
  }
  await dropDownloads(file);
  return record;
}

// Downloads left by an update that never finished. The server only downloads once it's running,
// so none is in use while the supervisor starts.
export async function dropDownloads(file: string) {
  const { dir, record } = updatePaths(file);
  const names = await readdir(dir).catch(() => []);
  await Promise.all(names.filter((name) => join(dir, name) !== record).map((name) => rm(join(dir, name), { force: true })));
}
