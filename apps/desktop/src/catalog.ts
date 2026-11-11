import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readSavedEnvironments, type SavedEnvironment } from "@runnerbox/client-runtime";

// Saved environments on disk, in the app's own data directory. Tokens are encrypted with the OS
// keychain when it's available, so the file alone doesn't let anyone reach a server.

export type TokenCipher = {
  readonly available: () => boolean;
  readonly encrypt: (text: string) => string;
  readonly decrypt: (text: string) => string;
};

type Stored = SavedEnvironment & { encrypted?: boolean };

export function createCatalog(directory: string, cipher: TokenCipher) {
  const path = join(directory, "environments.json");

  // Each entry's `encrypted` flag says how its token was written; entries from before routes
  // became a list are moved to the new shape as they're read.
  const readStored = async (): Promise<Stored[]> => {
    const text = await readFile(path, "utf8").catch(() => "[]");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return [];
    }
    const flags = Array.isArray(raw) ? raw.map((entry) => typeof entry === "object" && entry !== null && "encrypted" in entry && entry.encrypted === true) : [];
    return readSavedEnvironments(raw).map((environment, index) => ({ ...environment, encrypted: flags[index] ?? false }));
  };

  const writeStored = async (stored: ReadonlyArray<Stored>) => {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  };

  return {
    async list(): Promise<SavedEnvironment[]> {
      return (await readStored()).map(({ encrypted, token, ...environment }) => ({
        ...environment,
        token: token !== null && encrypted ? cipher.decrypt(token) : token,
      }));
    },
    async save(environment: SavedEnvironment) {
      const encrypted = cipher.available() && environment.token !== null;
      const entry = { ...environment, token: encrypted && environment.token !== null ? cipher.encrypt(environment.token) : environment.token, encrypted };
      const others = (await readStored()).filter((stored) => stored.environmentId !== environment.environmentId);
      await writeStored([...others, entry]);
    },
    async remove(environmentId: string) {
      await writeStored((await readStored()).filter((stored) => stored.environmentId !== environmentId));
    },
  };
}
