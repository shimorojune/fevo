/**
 * Everything the API reads and writes. Writes emit events, which the API
 * forwards to the dashboard over server-sent events. One API process does all
 * the writing, so an in-process emitter is enough; no LISTEN/NOTIFY needed.
 */
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, getTableColumns, inArray, ne, sql } from "drizzle-orm";
import { fingerprint, parameterCount, parseAgent, type AgentError } from "@fevo/agent-format";
import type { TrackFile } from "@fevo/tracks";
import { batches, drives, laps, models, tracks, trainingMetrics, trainingRuns, type Batch, type BatchStatus, type Db, type Drive, type Lap, type Model, type ModelStatus, type RunStatus, type Track, type TrainingRun } from "./db.ts";
import type { Verifier } from "./pool.ts";
import { agentShape, RULES_BY_ID, SIM_WASM_SHA256 } from "./rules.ts";

export type StoreEvent =
  | { type: "model"; model: ModelSummary }
  | { type: "run"; run: TrainingRun }
  | { type: "metrics"; runId: string; metrics: { step: number; values: Record<string, number> }[] }
  | { type: "drive"; drive: Drive }
  | { type: "batch"; batch: BatchSummary };

export interface NewDrive {
  modelId: string;
  trackId: string;
  seed: number;
  errorLevel: number;
  noiseSeed: number;
  ghostModelId?: string | undefined;
  status: string;
  steps: number;
  gatesPassed: number;
  hash: string;
  sectorEnds?: number[] | undefined;
  batchId?: number | undefined;
  createdBy: string;
}

export interface DriveFilter {
  modelId?: string | undefined;
  trackId?: string | undefined;
  status?: string | undefined;
  batchId?: number | undefined;
  limit?: number | undefined;
}

export interface NewBatch {
  modelIds: string[];
  trackIds: string[];
  seeds: number[];
  errorLevels: number[];
  draws: number;
  createdBy: string;
}

/** A batch with how far it has got: laps saved, and how many of them finished. */
export type BatchSummary = Batch & { done: number; finished: number };

/** Every saved lap of one model on one track at one driver-error level, summed up. */
export interface BenchmarkCell {
  modelId: string;
  rulesId: string;
  trackId: string;
  errorLevel: number;
  laps: number;
  finished: number;
  medianSteps: number | null;
  bestSteps: number | null;
}

/** Laps a batch runs: one per seed at 0% (the same lap every time), `draws` per seed with error on. */
export const batchTotal = (b: Pick<NewBatch, "modelIds" | "trackIds" | "seeds" | "errorLevels" | "draws">) =>
  b.modelIds.length * b.trackIds.length * b.seeds.length * b.errorLevels.reduce((n, e) => n + (e === 0 ? 1 : b.draws), 0);

export interface PostedLap {
  trackId: string;
  seed: number;
  errorLevel?: number | undefined;
  status: string;
  steps: number;
  hash: string;
}

export interface NewModel {
  name: string;
  rulesId: string;
  agentText: string;
  status?: ModelStatus | undefined;
  runId?: string | undefined;
  parentId?: string | undefined;
  notes?: string | undefined;
  laps?: PostedLap[] | undefined;
}

export interface TrackBenchmark {
  /** Clean laps (error level 0) finished out of run. */
  finished: number;
  total: number;
  /** Median steps of the finished clean laps, if two or more finished. */
  medianSteps: number | null;
}

export type ModelSummary = Omit<Model, "agent"> & { benchmark: Record<string, TrackBenchmark> };
export type TrackSummary = Omit<Track, "data">;

export type Published =
  | { ok: true; model: ModelSummary; duplicate: boolean }
  | { ok: false; status: 400 | 422; error: string; errors?: AgentError[] };

export class Store {
  readonly events = new EventEmitter<{ event: [StoreEvent] }>();
  readonly #db: Db;
  readonly #verifier: Verifier;

  constructor(db: Db, verifier: Verifier) {
    this.#db = db;
    this.#verifier = verifier;
    this.events.setMaxListeners(100);
  }

  // Tracks

  /** Insert baked tracks that aren't in the database yet. */
  async seedTracks(baked: { id: string; name: string; data: TrackFile }[]): Promise<number> {
    let n = 0;
    for (const t of baked) {
      const [row] = await this.#db
        .insert(tracks)
        .values({ id: t.id, name: t.name, kind: "real", sha256: t.data.sha256, lengthM: t.data.lengthM, data: t.data })
        .onConflictDoNothing()
        .returning({ id: tracks.id });
      if (row) n++;
    }
    return n;
  }

  async upsertTrack(t: { id: string; name: string; kind: string; data: TrackFile; expertLapS?: number | null | undefined; heldOut?: boolean | undefined }): Promise<TrackSummary> {
    const values = { name: t.name, kind: t.kind, sha256: t.data.sha256, lengthM: t.data.lengthM, data: t.data, expertLapS: t.expertLapS ?? null, heldOut: t.heldOut ?? false };
    const [row] = await this.#db.insert(tracks).values({ id: t.id, ...values }).onConflictDoUpdate({ target: tracks.id, set: values }).returning();
    const { data: _d, ...summary } = row!;
    return summary;
  }

  listTracks(): Promise<TrackSummary[]> {
    const { id, name, kind, sha256, lengthM, expertLapS, heldOut, createdAt } = tracks;
    return this.#db.select({ id, name, kind, sha256, lengthM, expertLapS, heldOut, createdAt }).from(tracks).orderBy(asc(tracks.name));
  }

  async getTrack(id: string): Promise<Track | undefined> {
    const [row] = await this.#db.select().from(tracks).where(eq(tracks.id, id));
    return row;
  }

  // Models

  async listModels(): Promise<ModelSummary[]> {
    const { id, name, rulesId, fingerprint, kind, parameters, status, runId, parentId, notes, createdAt } = models;
    const rows = await this.#db
      .select({ id, name, rulesId, fingerprint, kind, parameters, status, runId, parentId, notes, createdAt })
      .from(models)
      .orderBy(desc(models.createdAt));
    const all = rows.length ? await this.#db.select().from(laps).where(inArray(laps.modelId, rows.map((r) => r.id))) : [];
    return rows.map((r) => ({ ...r, benchmark: benchmark(all.filter((l) => l.modelId === r.id)) }));
  }

  async getModel(id: string): Promise<(Model & { laps: Lap[] }) | undefined> {
    const [row] = await this.#db.select().from(models).where(eq(models.id, id));
    if (!row) return undefined;
    const rowLaps = await this.#db.select().from(laps).where(eq(laps.modelId, id)).orderBy(asc(laps.trackId), asc(laps.errorLevel), asc(laps.seed));
    return { ...row, laps: rowLaps };
  }

  async #summary(id: string): Promise<ModelSummary> {
    const m = (await this.getModel(id))!;
    const { agent: _a, laps: l, ...rest } = m;
    return { ...rest, benchmark: benchmark(l) };
  }

  /**
   * Validate, re-run the clean official laps the publisher reported, and store
   * the model with its laps. Any official lap that doesn't reproduce rejects
   * the whole publish: it means the publisher ran a different sim build.
   */
  async publish(m: NewModel): Promise<Published> {
    const rules = RULES_BY_ID.get(m.rulesId);
    if (!rules) return { ok: false, status: 400, error: `Unknown rules ${m.rulesId}. This server knows ${[...RULES_BY_ID.keys()].join(", ")}.` };
    const parsed = parseAgent(m.agentText, agentShape(rules));
    if (!parsed.ok) return { ok: false, status: 422, error: "The agent file didn't pass validation.", errors: parsed.errors };
    const fp = await fingerprint(parsed.program);

    const [existing] = await this.#db.select({ id: models.id }).from(models).where(and(eq(models.rulesId, rules.id), eq(models.fingerprint, fp)));
    if (existing) return { ok: true, model: await this.#summary(existing.id), duplicate: true };

    const posted = m.laps ?? [];
    const trackIds = [...new Set(posted.map((l) => l.trackId))];
    const known = trackIds.length ? await this.#db.select().from(tracks).where(inArray(tracks.id, trackIds)) : [];
    const missing = trackIds.filter((id) => !known.some((t) => t.id === id));
    if (missing.length) return { ok: false, status: 400, error: `Unknown tracks: ${missing.join(", ")}. Post them first.` };

    // The clean official laps are re-run here; everything else is stored as reported.
    const official = (l: PostedLap) => (l.errorLevel ?? 0) === 0 && l.seed < rules.seeds.length;
    for (const t of known) {
      const claimed = posted.filter((l) => l.trackId === t.id && official(l));
      if (!claimed.length) continue;
      const v = await this.#verifier.verify({ rulesId: rules.id, track: t.data, agentText: m.agentText, claimed });
      if (v.mismatch) return { ok: false, status: 422, error: `${t.name}: laps don't reproduce on the server's sim.wasm (${SIM_WASM_SHA256.slice(0, 12)}). ${v.mismatch}` };
    }

    const id = randomUUID();
    if (m.status === "house") await this.#demoteHouse(rules.id);
    await this.#db.insert(models).values({
      id,
      name: m.name,
      rulesId: rules.id,
      fingerprint: fp,
      kind: parsed.program.kind,
      parameters: parameterCount(parsed.program),
      agent: m.agentText,
      status: m.status ?? "candidate",
      runId: m.runId ?? null,
      parentId: m.parentId ?? null,
      notes: m.notes ?? null,
    });
    if (posted.length) {
      await this.#db
        .insert(laps)
        .values(
          posted.map((l) => ({
            modelId: id,
            trackId: l.trackId,
            rulesId: rules.id,
            simSha256: SIM_WASM_SHA256,
            seed: l.seed,
            errorLevel: l.errorLevel ?? 0,
            status: l.status,
            steps: l.steps,
            hash: l.hash,
            source: official(l) ? "server" : "publish",
          })),
        )
        .onConflictDoNothing();
    }
    const model = await this.#summary(id);
    this.events.emit("event", { type: "model", model });
    return { ok: true, model, duplicate: false };
  }

  async updateModel(id: string, patch: { name?: string; status?: ModelStatus; notes?: string | null }): Promise<ModelSummary | undefined> {
    const [row] = await this.#db.select({ rulesId: models.rulesId }).from(models).where(eq(models.id, id));
    if (!row) return undefined;
    if (patch.status === "house") await this.#demoteHouse(row.rulesId, id);
    await this.#db.update(models).set(patch).where(eq(models.id, id));
    const model = await this.#summary(id);
    this.events.emit("event", { type: "model", model });
    return model;
  }

  /** One house driver per rules version. */
  async #demoteHouse(rulesId: string, except?: string) {
    const demoted = await this.#db
      .update(models)
      .set({ status: "candidate" })
      .where(and(eq(models.rulesId, rulesId), eq(models.status, "house"), ...(except ? [ne(models.id, except)] : [])))
      .returning({ id: models.id });
    for (const d of demoted) this.events.emit("event", { type: "model", model: await this.#summary(d.id) });
  }

  // Training runs

  // Drives: laps run from the dashboard

  async addDrive(d: NewDrive): Promise<{ ok: true; drive: Drive } | { ok: false; error: string }> {
    const [model] = await this.#db.select({ id: models.id, rulesId: models.rulesId }).from(models).where(eq(models.id, d.modelId));
    if (!model) return { ok: false, error: "No such model." };
    const [track] = await this.#db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, d.trackId));
    if (!track) return { ok: false, error: "No such track." };
    if (d.ghostModelId) {
      const [ghost] = await this.#db.select({ id: models.id }).from(models).where(eq(models.id, d.ghostModelId));
      if (!ghost) return { ok: false, error: "No such ghost model." };
    }
    if (d.batchId !== undefined) {
      const [batch] = await this.#db.select({ status: batches.status }).from(batches).where(eq(batches.id, d.batchId));
      if (!batch) return { ok: false, error: "No such batch." };
    }
    // A clean lap is verified when it matches the lap the server re-ran for this model, track and seed.
    let verified = false;
    if (d.errorLevel === 0) {
      const [known] = await this.#db
        .select({ hash: laps.hash, steps: laps.steps })
        .from(laps)
        .where(and(eq(laps.modelId, d.modelId), eq(laps.trackId, d.trackId), eq(laps.seed, d.seed), eq(laps.errorLevel, 0)));
      verified = !!known && known.hash === d.hash && known.steps === d.steps;
    }
    const [drive] = await this.#db
      .insert(drives)
      .values({ ...d, ghostModelId: d.ghostModelId ?? null, sectorEnds: d.sectorEnds ?? null, batchId: d.batchId ?? null, rulesId: model.rulesId, simSha256: SIM_WASM_SHA256, verified })
      .returning();
    this.events.emit("event", { type: "drive", drive: drive! });
    if (d.batchId !== undefined) await this.#finishIfComplete(d.batchId);
    return { ok: true, drive: drive! };
  }

  async listDrives(f: DriveFilter = {}): Promise<Drive[]> {
    const where = and(
      f.modelId ? eq(drives.modelId, f.modelId) : undefined,
      f.trackId ? eq(drives.trackId, f.trackId) : undefined,
      f.status ? eq(drives.status, f.status) : undefined,
      f.batchId !== undefined ? eq(drives.batchId, f.batchId) : undefined,
    );
    // A batch can hold thousands of laps; resuming one needs them all.
    const cap = f.batchId !== undefined ? 50_000 : 2000;
    return this.#db.select().from(drives).where(where).orderBy(desc(drives.createdAt), desc(drives.id)).limit(Math.min(f.limit ?? 500, cap));
  }

  async getDrive(id: number): Promise<Drive | undefined> {
    const [row] = await this.#db.select().from(drives).where(eq(drives.id, id));
    return row;
  }

  // Batches: many scenarios at once, run in the browser and saved as drives

  async createBatch(b: NewBatch): Promise<{ ok: true; batch: BatchSummary } | { ok: false; error: string }> {
    const known = await this.#db.select({ id: models.id }).from(models).where(inArray(models.id, b.modelIds));
    if (known.length !== new Set(b.modelIds).size) return { ok: false, error: "One of those models doesn't exist." };
    const knownTracks = await this.#db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, b.trackIds));
    if (knownTracks.length !== new Set(b.trackIds).size) return { ok: false, error: "One of those tracks doesn't exist." };
    const [row] = await this.#db
      .insert(batches)
      .values({ ...b, total: batchTotal(b), status: "running" })
      .returning();
    const batch = { ...row!, done: 0, finished: 0 };
    this.events.emit("event", { type: "batch", batch });
    return { ok: true, batch };
  }

  #batchQuery() {
    return this.#db
      .select({
        ...getTableColumns(batches),
        done: sql<number>`count(${drives.id})::int`,
        finished: sql<number>`(count(${drives.id}) filter (where ${drives.status} = 'finished'))::int`,
      })
      .from(batches)
      .leftJoin(drives, eq(drives.batchId, batches.id))
      .groupBy(batches.id);
  }

  listBatches(): Promise<BatchSummary[]> {
    return this.#batchQuery().orderBy(desc(batches.createdAt), desc(batches.id));
  }

  async getBatch(id: number): Promise<BatchSummary | undefined> {
    const [row] = await this.#batchQuery().where(eq(batches.id, id));
    return row;
  }

  /** Pause, resume or stop a batch. A finished batch stays finished. */
  async setBatchStatus(id: number, status: BatchStatus): Promise<BatchSummary | undefined> {
    const now = await this.getBatch(id);
    if (!now) return undefined;
    if (now.status === "done" || now.status === status) return now;
    const ended = status === "done" || status === "stopped" ? new Date() : null;
    await this.#db.update(batches).set({ status, endedAt: ended }).where(eq(batches.id, id));
    const batch = (await this.getBatch(id))!;
    this.events.emit("event", { type: "batch", batch });
    return batch;
  }

  async #finishIfComplete(id: number) {
    const [b] = await this.#db.select({ total: batches.total, status: batches.status }).from(batches).where(eq(batches.id, id));
    if (!b || b.status === "done") return;
    const [n] = await this.#db.select({ n: count() }).from(drives).where(eq(drives.batchId, id));
    if (n!.n >= b.total) await this.setBatchStatus(id, "done");
  }

  /** Benchmarks: every model on every track at every driver-error level, from the saved laps. */
  benchmarks(): Promise<BenchmarkCell[]> {
    const fin = sql`${drives.status} = 'finished'`;
    return this.#db
      .select({
        modelId: drives.modelId,
        rulesId: drives.rulesId,
        trackId: drives.trackId,
        errorLevel: drives.errorLevel,
        laps: sql<number>`count(*)::int`,
        finished: sql<number>`(count(*) filter (where ${fin}))::int`,
        medianSteps: sql<number | null>`(percentile_disc(0.5) within group (order by ${drives.steps}) filter (where ${fin}))::int`,
        bestSteps: sql<number | null>`(min(${drives.steps}) filter (where ${fin}))::int`,
      })
      .from(drives)
      .groupBy(drives.modelId, drives.rulesId, drives.trackId, drives.errorLevel);
  }

  async createRun(r: { name: string; method: string; machine?: string | undefined; config?: Record<string, unknown> | undefined; notes?: string | undefined }): Promise<TrainingRun> {
    const [run] = await this.#db
      .insert(trainingRuns)
      .values({ id: randomUUID(), name: r.name, method: r.method, machine: r.machine ?? null, config: r.config ?? null, notes: r.notes ?? null, status: "running" })
      .returning();
    this.events.emit("event", { type: "run", run: run! });
    return run!;
  }

  async updateRun(id: string, patch: { status?: RunStatus; notes?: string | null; bestModelId?: string | null }): Promise<TrainingRun | undefined> {
    const ended = patch.status && patch.status !== "running" ? { endedAt: new Date() } : {};
    const [run] = await this.#db.update(trainingRuns).set({ ...patch, ...ended }).where(eq(trainingRuns.id, id)).returning();
    if (run) this.events.emit("event", { type: "run", run });
    return run;
  }

  /** Record metrics; a step posted twice keeps the latest values. */
  async addMetrics(runId: string, metrics: { step: number; values: Record<string, number> }[]): Promise<boolean> {
    const [run] = await this.#db.select({ id: trainingRuns.id }).from(trainingRuns).where(eq(trainingRuns.id, runId));
    if (!run) return false;
    if (metrics.length) {
      for (const m of metrics) {
        await this.#db
          .insert(trainingMetrics)
          .values({ runId, step: m.step, values: m.values })
          .onConflictDoUpdate({ target: [trainingMetrics.runId, trainingMetrics.step], set: { values: m.values, at: new Date() } });
      }
      this.events.emit("event", { type: "metrics", runId, metrics });
    }
    return true;
  }

  listRuns(): Promise<TrainingRun[]> {
    return this.#db.select().from(trainingRuns).orderBy(desc(trainingRuns.startedAt));
  }

  async getRun(id: string) {
    const [run] = await this.#db.select().from(trainingRuns).where(eq(trainingRuns.id, id));
    if (!run) return undefined;
    const metrics = await this.#db
      .select({ step: trainingMetrics.step, at: trainingMetrics.at, values: trainingMetrics.values })
      .from(trainingMetrics)
      .where(eq(trainingMetrics.runId, id))
      .orderBy(asc(trainingMetrics.step));
    const runModels = await this.#db.select({ id: models.id, name: models.name, status: models.status, createdAt: models.createdAt }).from(models).where(eq(models.runId, id));
    return { ...run, metrics, models: runModels };
  }
}

/** Clean laps per track: how many finished, and their median. */
function benchmark(rows: readonly Lap[]): Record<string, TrackBenchmark> {
  const out: Record<string, TrackBenchmark> = {};
  for (const l of rows) {
    if (l.errorLevel !== 0) continue;
    const b = (out[l.trackId] ??= { finished: 0, total: 0, medianSteps: null });
    b.total++;
    if (l.status === "finished") b.finished++;
  }
  for (const [trackId, b] of Object.entries(out)) {
    const steps = rows.filter((l) => l.trackId === trackId && l.errorLevel === 0 && l.status === "finished").map((l) => l.steps).sort((a, c) => a - c);
    // Same rule as an official result: with three laps the middle one, with two the slower.
    b.medianSteps = steps.length >= 2 ? steps[Math.floor(steps.length / 2)]! : null;
  }
  return out;
}
