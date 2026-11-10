import { readFile, stat } from "node:fs/promises";

// Reads the token that mints runners, and refuses a file other users could read. Windows has no
// mode bits to check: there the file belongs in the owner's profile, which other accounts can't open.
export async function readTokenFile(path: string) {
  const { mode } = await stat(path);
  if (process.platform !== "win32" && (mode & 0o077) !== 0) throw new Error(`${path} must be readable only by its owner (chmod 600)`);

  const token = (await readFile(path, "utf8")).trim();
  if (!token) throw new Error(`${path} is empty`);
  return token;
}
