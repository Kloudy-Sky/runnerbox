import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SavedEnvironment } from "@runnerbox/client-runtime";
import * as Schema from "effect/Schema";

// Saved environments on disk, in the app's own data directory. Tokens are encrypted with the OS
// keychain when it's available, so the file alone doesn't let anyone reach a server.
const Stored = Schema.Struct({ ...SavedEnvironment.fields, token: Schema.String, encrypted: Schema.Boolean });
const decodeStored = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Stored)));

export type TokenCipher = {
  readonly available: () => boolean;
  readonly encrypt: (text: string) => string;
  readonly decrypt: (text: string) => string;
};

export function createCatalog(directory: string, cipher: TokenCipher) {
  const path = join(directory, "environments.json");

  const readStored = async () => {
    const text = await readFile(path, "utf8").catch(() => "[]");
    try {
      return [...decodeStored(text)];
    } catch {
      return [];
    }
  };

  const writeStored = async (stored: ReadonlyArray<typeof Stored.Type>) => {
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(stored, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  };

  return {
    async list(): Promise<SavedEnvironment[]> {
      return (await readStored()).map(({ encrypted, token, ...environment }) => ({
        ...environment,
        token: encrypted ? cipher.decrypt(token) : token,
      }));
    },
    async save(environment: SavedEnvironment) {
      const encrypted = cipher.available();
      const entry = { ...environment, token: encrypted ? cipher.encrypt(environment.token) : environment.token, encrypted };
      const others = (await readStored()).filter((stored) => stored.environmentId !== environment.environmentId);
      await writeStored([...others, entry]);
    },
    async remove(environmentId: string) {
      await writeStored((await readStored()).filter((stored) => stored.environmentId !== environmentId));
    },
  };
}
