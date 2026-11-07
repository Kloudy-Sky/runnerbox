import { readFile, stat } from "node:fs/promises";

// Reads the token that mints runners, and refuses a file other users could read.
export async function readTokenFile(path: string) {
  const { mode } = await stat(path);
  if ((mode & 0o077) !== 0) throw new Error(`${path} must be readable only by its owner (chmod 600)`);

  const token = (await readFile(path, "utf8")).trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}
