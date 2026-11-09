import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

// An append-only NDJSON file that rolls over to `<path>.1` … `<path>.<keep>` past `maxBytes`, so
// recording for months can't fill the disk. Appends are queued, so lines never interleave.
export function createRotatingLog(path: string, { maxBytes = 10_000_000, keep = 4 } = {}) {
  let queue = Promise.resolve();

  async function rotateIfFull() {
    const size = await stat(path).then((stats) => stats.size, () => 0);
    if (size < maxBytes) return;
    for (let index = keep - 1; index >= 1; index--) {
      await rename(`${path}.${index}`, `${path}.${index + 1}`).catch(() => {});
    }
    await rename(path, `${path}.1`);
  }

  return {
    path,
    append(record: object) {
      queue = queue
        .then(async () => {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          await rotateIfFull();
          await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        })
        .catch((error: unknown) => console.error(`Couldn't write ${path}: ${error instanceof Error ? error.message : error}`));
      return queue;
    },
  };
}
