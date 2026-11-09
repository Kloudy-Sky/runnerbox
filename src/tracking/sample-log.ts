import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type } from "arktype";
import { type Sample, SampleRecord } from "./sample-record.ts";

export type InstallSample = { install: string; sample: Sample };

// Every install's samples under `dir`, oldest first, including rotated files, each tagged with the
// install that recorded it. Unreadable lines are skipped, since one bad line a minute is cheap to lose.
export async function readSamples(dir: string) {
  const installs = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const samples: InstallSample[] = [];
  for (const install of installs.filter((entry) => entry.isDirectory())) {
    for (const suffix of ["", ".1", ".2", ".3", ".4"]) {
      const text = await readFile(join(dir, install.name, `samples.ndjson${suffix}`), "utf8").catch(() => "");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const sample = SampleRecord(JSON.parse(line));
          if (!(sample instanceof type.errors)) samples.push({ install: install.name, sample });
        } catch {}
      }
    }
  }
  return samples.toSorted((a, b) => Date.parse(a.sample.time) - Date.parse(b.sample.time));
}
