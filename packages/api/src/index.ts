import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildServer } from "./server.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString, max: 5 });
// Serve the built web app when it exists (after `npm run build -w @spil/web`).
const webRoot = process.env.WEB_ROOT ?? fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url));
const app = buildServer(pool, { logger: true, webRoot: existsSync(webRoot) ? webRoot : undefined });
const port = Number(process.env.PORT ?? 3001);

await app.listen({ port, host: "0.0.0.0" });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
