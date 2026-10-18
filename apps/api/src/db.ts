/**
 * Storage. Postgres in production (DATABASE_URL); an embedded PGlite
 * database for local dev and tests, so nothing needs installing to run it.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ClaimedLap, ServerLap } from "./verify.ts";

export const SUBMISSION_STATUS = ["queued", "verified", "unranked", "mismatch", "failed"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];

export const submissions = pgTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    driver: text("driver").notNull(),
    /** The GitHub account that submitted it; null for entries from before sign-in. */
    userId: text("user_id"),
    circuit: text("circuit").notNull(),
    rulesId: text("rules_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    parameters: integer("parameters").notNull(),
    agent: text("agent").notNull(),
    claimed: jsonb("claimed").$type<ClaimedLap[]>(),
    status: text("status").$type<SubmissionStatus>().notNull(),
    detail: text("detail"),
    laps: jsonb("laps").$type<ServerLap[]>(),
    medianSteps: integer("median_steps"),
    simSha256: text("sim_sha256"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("submissions_entry").on(t.rulesId, t.circuit, t.fingerprint)],
);

export type Submission = typeof submissions.$inferSelect;

/** GitHub accounts that have signed in. id is GitHub's numeric user id, as text. */
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;

/** Sign-in sessions. The cookie holds the token; only its SHA-256 is stored. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS submissions (
    id text PRIMARY KEY,
    driver text NOT NULL,
    circuit text NOT NULL,
    rules_id text NOT NULL,
    fingerprint text NOT NULL,
    kind text NOT NULL,
    parameters integer NOT NULL,
    agent text NOT NULL,
    claimed jsonb,
    status text NOT NULL,
    detail text,
    laps jsonb,
    median_steps integer,
    sim_sha256 text,
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz
  );
  ALTER TABLE submissions ADD COLUMN IF NOT EXISTS user_id text;
  CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    login text NOT NULL,
    name text,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users (id),
    expires_at timestamptz NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS submissions_entry ON submissions (rules_id, circuit, fingerprint);
  CREATE INDEX IF NOT EXISTS submissions_board ON submissions (rules_id, circuit, status, median_steps, created_at);
`;

/** Connect and create the schema. Without a URL, an in-memory PGlite database (or a directory, with dataDir). */
export async function openDb(opts: { url?: string | undefined; dataDir?: string | undefined } = {}): Promise<{ db: Db; close: () => Promise<void> }> {
  if (opts.url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(opts.url);
    const db = drizzle(client) as unknown as Db;
    await client.unsafe(SCHEMA);
    return { db, close: () => client.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  await client.exec(SCHEMA);
  return { db: drizzle(client) as unknown as Db, close: () => client.close() };
}

