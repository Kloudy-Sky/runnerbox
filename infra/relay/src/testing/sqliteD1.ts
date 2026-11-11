import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Like, D1Statement } from "../store.ts";

// D1's statement API over an in-memory node:sqlite database with the real migrations applied, so
// tests run the same SQL the deployed Worker does.
export function sqliteD1(): D1Like {
  const db = new DatabaseSync(":memory:");
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).toSorted()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  const statement = (sql: string, values: unknown[]): D1Statement => ({
    bind: (...next) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...(values as never[])) as T | undefined) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(values as never[])).changes) } }),
    all: async <T>() => ({ results: db.prepare(sql).all(...(values as never[])) as T[] }),
  });
  return { prepare: (sql) => statement(sql, []) };
}
