import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Hashes names with a key kept on the host, so a name hashes the same every week and summaries
// can be compared, but nobody without the key can test guesses against them.
export const createRedactor = (key: string) => (name: string) =>
  `#${createHmac("sha256", key).update(name).digest("hex").slice(0, 8)}`;

const KEY = /^[0-9a-f]{64}$/;

// A key file that exists but isn't a key, such as one cut short on a full disk, is an error rather
// than replaced: replacing it would change every hash, and using it could leave names guessable.
export async function loadRedactionKey(dir: string) {
  const path = join(dir, "summary.key");
  const read = () =>
    readFile(path, "utf8").then(
      (text) => {
        const key = text.trim();
        if (!KEY.test(key)) throw new Error(`${path} isn't a redaction key. Delete it to make a new one.`);
        return key;
      },
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );

  const existing = await read();
  if (existing) return existing;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // `wx` fails if another run wrote it first, and then that key is read back.
  await writeFile(path, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" }).catch(() => {});
  const written = await read();
  if (!written) throw new Error(`Couldn't create ${path}.`);
  return written;
}
