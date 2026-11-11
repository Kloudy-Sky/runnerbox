import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

// Writes an owner-only file so readers see the old contents or the new, never half of either.
export const writeFileAtomic = (fs: FileSystem.FileSystem, path: string, text: string) => {
  const temporary = `${path}.${process.pid}.tmp`;
  return fs.writeFileString(temporary, text, { mode: 0o600 }).pipe(Effect.andThen(fs.rename(temporary, path)));
};
