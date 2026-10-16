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

