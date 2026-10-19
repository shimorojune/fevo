/**
 * Storage. Postgres in production (DATABASE_URL); an embedded PGlite
 * database for local dev and tests, so nothing needs installing to run it.
 *
 * Everything the dashboard shows lives here: tracks, published models, their
 * benchmark laps, and training runs with their per-step metrics. Replays are
 * never stored; the browser recomputes them from model + track + rules.
 */
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { bigserial, boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { TrackFile } from "@fevo/tracks";

export const MODEL_STATUS = ["candidate", "house", "archived"] as const;
export type ModelStatus = (typeof MODEL_STATUS)[number];

export const RUN_STATUS = ["running", "done", "failed", "stopped"] as const;
export type RunStatus = (typeof RUN_STATUS)[number];

export const tracks = pgTable("tracks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** "real" (TUMFTM and similar) or "procedural". */
  kind: text("kind").notNull(),
  sha256: text("sha256").notNull(),
  lengthM: doublePrecision("length_m").notNull(),
  /** Reference lap by a human expert, in seconds, where one exists. */
  expertLapS: doublePrecision("expert_lap_s"),
  heldOut: boolean("held_out").notNull().default(false),
  data: jsonb("data").$type<TrackFile>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingRuns = pgTable("training_runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  method: text("method").notNull(),
  machine: text("machine"),
  config: jsonb("config").$type<Record<string, unknown>>(),
  status: text("status").$type<RunStatus>().notNull(),
  notes: text("notes"),
  bestModelId: text("best_model_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const trainingMetrics = pgTable(
  "training_metrics",
  {
    runId: text("run_id").notNull(),
    /** Generation, epoch or iteration, as the trainer counts it. */
    step: integer("step").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    values: jsonb("values").$type<Record<string, number>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.step] })],
);

export const models = pgTable(
  "models",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rulesId: text("rules_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    parameters: integer("parameters").notNull(),
    agent: text("agent").notNull(),
    status: text("status").$type<ModelStatus>().notNull(),
    runId: text("run_id"),
    parentId: text("parent_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("models_fingerprint").on(t.rulesId, t.fingerprint)],
);

export const laps = pgTable(
  "laps",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    modelId: text("model_id").notNull(),
    trackId: text("track_id").notNull(),
    rulesId: text("rules_id").notNull(),
    simSha256: text("sim_sha256").notNull(),
    seed: integer("seed").notNull(),
    /** Driver error level the lap was run with, 0 for a clean lap. */
    errorLevel: doublePrecision("error_level").notNull().default(0),
    status: text("status").notNull(),
    steps: integer("steps").notNull(),
    hash: text("hash").notNull(),
    /** "publish" when posted by fevo publish, "server" when the API re-ran it. */
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("laps_entry").on(t.modelId, t.trackId, t.seed, t.errorLevel)],
);

/**
 * A lap run from the dashboard's Run screen: one model, one track, one seed, at a driver-error
 * level, with an optional ghost to compare against. Kept forever; History lists them.
 */
export const drives = pgTable("drives", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  modelId: text("model_id").notNull(),
  trackId: text("track_id").notNull(),
  rulesId: text("rules_id").notNull(),
  simSha256: text("sim_sha256").notNull(),
  seed: integer("seed").notNull(),
  errorLevel: doublePrecision("error_level").notNull().default(0),
  /** Seed of the driver-error noise; with the rest it replays the lap exactly. */
  noiseSeed: integer("noise_seed").notNull().default(0),
  ghostModelId: text("ghost_model_id"),
  status: text("status").notNull(),
  steps: integer("steps").notNull(),
  gatesPassed: integer("gates_passed").notNull(),
  hash: text("hash").notNull(),
  /** Step (fractional) at which each mini sector ended, for F1 sector colours against later runs. */
  sectorEnds: jsonb("sector_ends").$type<number[]>(),
  /** True when a clean lap matches the lap the server verified for this model, track and seed. */
  verified: boolean("verified").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Track = typeof tracks.$inferSelect;
export type Drive = typeof drives.$inferSelect;
export type TrainingRun = typeof trainingRuns.$inferSelect;
export type TrainingMetric = typeof trainingMetrics.$inferSelect;
export type Model = typeof models.$inferSelect;
export type Lap = typeof laps.$inferSelect;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS tracks (
    id text PRIMARY KEY,
    name text NOT NULL,
    kind text NOT NULL,
    sha256 text NOT NULL,
    length_m double precision NOT NULL,
    expert_lap_s double precision,
    held_out boolean NOT NULL DEFAULT false,
    data jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS training_runs (
    id text PRIMARY KEY,
    name text NOT NULL,
    method text NOT NULL,
    machine text,
    config jsonb,
    status text NOT NULL,
    notes text,
    best_model_id text,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz
  );
  CREATE TABLE IF NOT EXISTS training_metrics (
    run_id text NOT NULL REFERENCES training_runs(id) ON DELETE CASCADE,
    step integer NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    values jsonb NOT NULL,
    PRIMARY KEY (run_id, step)
  );
  CREATE TABLE IF NOT EXISTS models (
    id text PRIMARY KEY,
    name text NOT NULL,
    rules_id text NOT NULL,
    fingerprint text NOT NULL,
    kind text NOT NULL,
    parameters integer NOT NULL,
    agent text NOT NULL,
    status text NOT NULL,
    run_id text REFERENCES training_runs(id) ON DELETE SET NULL,
    parent_id text REFERENCES models(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS models_fingerprint ON models (rules_id, fingerprint);
  CREATE TABLE IF NOT EXISTS laps (
    id bigserial PRIMARY KEY,
    model_id text NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    track_id text NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    rules_id text NOT NULL,
    sim_sha256 text NOT NULL,
    seed integer NOT NULL,
    error_level double precision NOT NULL DEFAULT 0,
    status text NOT NULL,
    steps integer NOT NULL,
    hash text NOT NULL,
    source text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS laps_entry ON laps (model_id, track_id, seed, error_level);
  CREATE INDEX IF NOT EXISTS laps_track ON laps (track_id, rules_id, status, steps);
  CREATE TABLE IF NOT EXISTS drives (
    id bigserial PRIMARY KEY,
    model_id text NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    track_id text NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    rules_id text NOT NULL,
    sim_sha256 text NOT NULL,
    seed integer NOT NULL,
    error_level double precision NOT NULL DEFAULT 0,
    noise_seed integer NOT NULL DEFAULT 0,
    ghost_model_id text REFERENCES models(id) ON DELETE SET NULL,
    status text NOT NULL,
    steps integer NOT NULL,
    gates_passed integer NOT NULL,
    hash text NOT NULL,
    sector_ends jsonb,
    verified boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS drives_recent ON drives (created_at DESC);
  CREATE INDEX IF NOT EXISTS drives_model_track ON drives (model_id, track_id);
`;

/** Connect and create the schema. Without a URL, an in-memory PGlite database (or a directory, with dataDir). */
export async function openDb(opts: { url?: string | undefined; dataDir?: string | undefined } = {}): Promise<{ db: Db; close: () => Promise<void> }> {
  if (opts.url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(opts.url, { onnotice: () => {} });
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
