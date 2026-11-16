import { fileURLToPath } from "node:url";
import { CATEGORIES, classify } from "@spil/catalog";
import type pg from "pg";
import { createPool, inTransaction } from "./db/pool.js";

/**
 * Sync the categories defined in code to the database, then put every
 * product in its category (or none). Rules are cheap to run, so every
 * product is re-checked on each run: changing a rule takes effect on the
 * next run, with no bookkeeping. Only rows whose category changed are written.
 */
export async function classifyProducts(pool: pg.Pool): Promise<{ classified: number; changed: number }> {
  return inTransaction(pool, async (db) => {
    const { rows: cats } = await db.query<{ id: number; key: string }>(
      `INSERT INTO categories (key, name, unit, shelf_life_days)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[])
       ON CONFLICT (key) DO UPDATE
         SET name = EXCLUDED.name, unit = EXCLUDED.unit, shelf_life_days = EXCLUDED.shelf_life_days
       RETURNING id, key`,
      [
        CATEGORIES.map((c) => c.key),
        CATEGORIES.map((c) => c.name),
        CATEGORIES.map((c) => c.unit),
        CATEGORIES.map((c) => c.shelfLifeDays ?? null),
      ],
    );
    const categoryId = new Map(cats.map((c) => [c.key, c.id]));

    const { rows: products } = await db.query<{
      id: number;
      name: string;
      quantity: number | null;
      unit: string | null;
      is_weighted: boolean;
      category_id: number | null;
    }>("SELECT id, name, quantity::float AS quantity, unit, is_weighted, category_id FROM products");

    const ids: number[] = [];
    const newCategories: Array<number | null> = [];
    let classified = 0;
    for (const p of products) {
      const c = classify({ id: p.id, name: p.name, quantity: p.quantity, unit: p.unit, isWeighted: p.is_weighted });
      const target = c ? (categoryId.get(c.category.key) ?? null) : null;
      if (target !== null) classified++;
      if (target !== p.category_id) {
        ids.push(p.id);
        newCategories.push(target);
      }
    }
    await db.query(
      `UPDATE products p SET category_id = u.category_id
       FROM unnest($1::int[], $2::int[]) AS u(id, category_id)
       WHERE p.id = u.id`,
      [ids, newCategories],
    );
    return { classified, changed: ids.length };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try {
    const { classified, changed } = await classifyProducts(pool);
    console.log(`${classified} products in a category, ${changed} changed`);
  } finally {
    await pool.end();
  }
}
