/**
 * fevo API server.
 *   DATABASE_URL  Postgres connection string; unset = embedded PGlite (DATA_DIR, or in memory)
 *   PORT          default 8787
 *   CORS_ORIGINS  comma-separated, default http://localhost:5173
 *   VERIFIERS     verifier workers, default cores - 1
 *   SITE_URL      the site's origin, default http://localhost:5173; the API must be served under it at /api
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 *                 GitHub OAuth app; its callback URL is SITE_URL/api/auth/github/callback
 *   DEV_LOGIN=1   allow signing in as any login without GitHub (local dev only)
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { Auth } from "./auth.ts";
import { openDb } from "./db.ts";
import { createPool } from "./pool.ts";
import { RULES, SIM_WASM_SHA256 } from "./season.ts";
import { Submissions } from "./submissions.ts";

const env = process.env;
const { db, close } = await openDb({ url: env.DATABASE_URL, dataDir: env.DATA_DIR });
const pool = createPool(env.VERIFIERS ? Number(env.VERIFIERS) : undefined);
const subs = new Submissions(db, pool);
const auth = new Auth(db, {
  siteUrl: env.SITE_URL ?? "http://localhost:5173",
  github: env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } : undefined,
  devLogin: env.DEV_LOGIN === "1",
});
if (!auth.providers.github && !auth.providers.dev) console.warn("No sign-in configured: set GITHUB_CLIENT_ID/SECRET or DEV_LOGIN=1, or nobody can submit.");
const app = createApp(subs, auth, { corsOrigins: env.CORS_ORIGINS?.split(",") });

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
