import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Hashes names with a key kept on the host, so a name hashes the same every week and summaries
// can be compared, but nobody without the key can test guesses against them.
export const createRedactor = (key: string) => (name: string) =>
  `#${createHmac("sha256", key).update(name).digest("hex").slice(0, 8)}`;

export async function loadRedactionKey(dir: string) {
  const path = join(dir, "summary.key");
  const existing = await readFile(path, "utf8").catch(() => "");
  if (existing.trim()) return existing.trim();
  const key = randomBytes(32).toString("hex");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // `wx` fails if another run wrote it first, and then that key is read back.
  await writeFile(path, `${key}\n`, { mode: 0o600, flag: "wx" }).catch(() => {});
  return (await readFile(path, "utf8")).trim();
}
