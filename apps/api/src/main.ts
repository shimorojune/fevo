/**
 * fevo API server.
 *   DATABASE_URL  Postgres connection string; unset = embedded PGlite (DATA_DIR, or in memory)
 *   PORT          default 8787
 *   CORS_ORIGINS  comma-separated, default http://localhost:5173
 *   VERIFIERS     verifier workers, default cores - 1
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { createPool } from "./pool.ts";
import { RULES, SIM_WASM_SHA256 } from "./season.ts";
import { Submissions } from "./submissions.ts";

const env = process.env;
const { db, close } = await openDb({ url: env.DATABASE_URL, dataDir: env.DATA_DIR });
const pool = createPool(env.VERIFIERS ? Number(env.VERIFIERS) : undefined);
const subs = new Submissions(db, pool);
const app = createApp(subs, { corsOrigins: env.CORS_ORIGINS?.split(",") });

const resumed = await subs.resume();
const port = Number(env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`fevo api on :${port}, rules ${RULES.id}, sim.wasm ${SIM_WASM_SHA256.slice(0, 12)}, ${resumed} queued submissions resumed`);
});

const shutdown = async () => {
  server.close();
  await subs.drain();
  await pool.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
