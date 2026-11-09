import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

// Hashes the path, type, mode and contents of everything under `dir`, so any change to a build
// context gives its image a new tag.
export async function hashContext(dir: string) {
  const hash = createHash("sha256");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const paths = entries.map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();

  for (const path of paths) {
    const full = join(dir, path);
    const stats = await lstat(full);
    hash.update(`${path}\0${stats.mode}\0`);
    if (stats.isSymbolicLink()) hash.update(await readlink(full));
    else if (stats.isFile()) hash.update(await readFile(full));
    hash.update("\0");
  }
  return hash.digest("hex");
}
