import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { type Sample, SampleRecord } from "./sample-record.ts";

// Every install's samples under `dir`, oldest first, including rotated files. Unreadable lines are
// skipped, since a sample a minute makes one bad line cheap to lose.
export async function readSamples(dir: string) {
  const installs = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const samples: Sample[] = [];
  for (const install of installs.filter((entry) => entry.isDirectory())) {
    for (const suffix of ["", ".1", ".2", ".3", ".4"]) {
      const text = await readFile(join(dir, install.name, `samples.ndjson${suffix}`), "utf8").catch(() => "");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const sample = SampleRecord(JSON.parse(line));
          if (!(sample instanceof type.errors)) samples.push(sample);
        } catch {}
      }
    }
  }
  return samples.toSorted((a, b) => Date.parse(a.time) - Date.parse(b.time));
}
