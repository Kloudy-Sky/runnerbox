import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Type, type } from "arktype";

// Every install's `file` under `dir`, including its rotated copies, each line checked against
// `schema` and tagged with the install that wrote it. Unreadable lines are skipped: these logs
// gain a line a minute, so one lost line is cheap.
export async function readInstallLogs<Schema extends Type>(dir: string, file: string, schema: Schema) {
  const installs = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const entries: { install: string; record: Schema["infer"] }[] = [];
  for (const install of installs.filter((entry) => entry.isDirectory())) {
    for (const suffix of ["", ".1", ".2", ".3", ".4"]) {
      const text = await readFile(join(dir, install.name, `${file}${suffix}`), "utf8").catch(() => "");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try {
          const record = schema(JSON.parse(line));
          if (!(record instanceof type.errors)) entries.push({ install: install.name, record });
        } catch {}
      }
    }
  }
  return entries;
}
