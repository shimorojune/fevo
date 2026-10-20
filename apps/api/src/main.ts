/**
 * fevo API server.
 *   DATABASE_URL        Postgres connection string; unset = embedded PGlite (DATA_DIR, or in memory)
 *   PORT                default 8787
 *   WEB_DIST            serve the built dashboard from this directory (one origin for both)
 *   VERIFIERS           verifier workers, default 2
 *   AUTH_USER, AUTH_PASSWORD_HASH, SESSION_SECRET, PUBLISH_KEY   see src/auth.ts
 *   INSECURE_COOKIES=1  allow the session cookie over plain http (local dev only)
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { openDb } from "./db.ts";
import { createPool } from "./pool.ts";
import { bakedTracks, DEFAULT_RULES, SIM_WASM_SHA256 } from "./rules.ts";
import { Store } from "./store.ts";

const env = process.env;
const required = ["AUTH_USER", "AUTH_PASSWORD_HASH", "SESSION_SECRET", "PUBLISH_KEY"] as const;
const missing = required.filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}. See apps/api/src/auth.ts.`);
  process.exit(1);
}
if (env.SESSION_SECRET!.length < 32 || env.PUBLISH_KEY!.length < 32) {
  console.error("SESSION_SECRET and PUBLISH_KEY must be at least 32 characters (openssl rand -hex 32).");
  process.exit(1);
}

const { db, close } = await openDb({ url: env.DATABASE_URL, dataDir: env.DATA_DIR });
// Laps run in the browser; the server only re-checks published ones, so a small pool is plenty.
const pool = createPool(env.VERIFIERS ? Number(env.VERIFIERS) : 2);
const store = new Store(db, pool);
const auth = createAuth({
  user: env.AUTH_USER!,
  passwordHash: env.AUTH_PASSWORD_HASH!,
  sessionSecret: env.SESSION_SECRET!,
  publishKey: env.PUBLISH_KEY!,
  secureCookies: env.INSECURE_COOKIES !== "1",
});
const app = createApp(store, auth, { webDist: env.WEB_DIST });

const seeded = await store.seedTracks(bakedTracks());
const port = Number(env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`fevo api on :${port}, default rules ${DEFAULT_RULES.id}, sim.wasm ${SIM_WASM_SHA256.slice(0, 12)}, ${seeded} tracks seeded${env.WEB_DIST ? `, serving ${env.WEB_DIST}` : ""}`);
});

const shutdown = async () => {
  server.close();
  await pool.close();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
