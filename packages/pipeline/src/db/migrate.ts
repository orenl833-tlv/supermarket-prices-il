import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { createPool, inTransaction } from "./pool.js";

/**
 * Apply SQL files from db/migrations in name order, each once, each in its
 * own transaction. Applied files are recorded in schema_migrations and must
 * never be edited afterwards: add a new file instead.
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../db/migrations/", import.meta.url));

export async function migrate(pool: pg.Pool, log = console.log): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(MIGRATIONS_DIR + file, "utf8");
    await inTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    log(`applied ${file}`);
    applied.push(file);
  }
  return applied;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  migrate(pool)
    .then((applied) => console.log(applied.length ? "migrations done" : "nothing to apply"))
    .finally(() => pool.end());
}
