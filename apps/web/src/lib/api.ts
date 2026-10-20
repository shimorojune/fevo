/**
 * The fevo API (apps/api). In dev, Vite proxies /api to it; in production the
 * API serves this app, so every call is same-origin and carries the session cookie.
 */
import { useEffect, useState } from "react";
import type { TrackFile } from "@fevo/tracks";

export type ModelStatus = "candidate" | "house" | "archived";
export type RunStatus = "running" | "done" | "failed" | "stopped";

export interface TrackBenchmark {
  finished: number;
  total: number;
  medianSteps: number | null;
  lapTime: string | null;
}

export interface ModelSummary {
  id: string;
  name: string;
  rulesId: string;
  fingerprint: string;
  kind: "neat-genome" | "mlp";
  parameters: number;
  status: ModelStatus;
  runId: string | null;
  parentId: string | null;
  notes: string | null;
  createdAt: string;
  benchmark: Record<string, TrackBenchmark>;
}

export interface Lap {
  trackId: string;
  seed: number;
  errorLevel: number;
  status: string;
  steps: number;
  hash: string;
  source: "publish" | "server";
}

export interface Model extends Omit<ModelSummary, "benchmark"> {
  agent: string;
  laps: Lap[];
}

export interface TrackSummary {
  id: string;
  name: string;
  kind: "real" | "procedural";
  sha256: string;
  lengthM: number;
  expertLapS: number | null;
  heldOut: boolean;
}

export interface TrainingRun {
  id: string;
  name: string;
  method: string;
  machine: string | null;
  config: Record<string, unknown> | null;
  status: RunStatus;
  notes: string | null;
  bestModelId: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface Metric {
  step: number;
  values: Record<string, number>;
}

export interface RunDetail extends TrainingRun {
  metrics: (Metric & { at: string })[];
  models: { id: string; name: string; status: ModelStatus; createdAt: string }[];
}

/** A lap run from the Run screen and kept for History. */
export interface Drive {
  id: number;
  modelId: string;
  trackId: string;
  rulesId: string;
  simSha256: string;
  seed: number;
  errorLevel: number;
  noiseSeed: number;
  ghostModelId: string | null;
  status: string;
  steps: number;
  gatesPassed: number;
  hash: string;
  sectorEnds: number[] | null;
  verified: boolean;
  batchId: number | null;
  createdBy: string;
  createdAt: string;
  lapTime: string | null;
}

export type BatchStatus = "running" | "paused" | "done" | "stopped";

/** Many scenarios run in one go; each lap is a drive tagged with the batch. */
export interface Batch {
  id: number;
  modelIds: string[];
  trackIds: string[];
  seeds: number[];
  errorLevels: number[];
  draws: number;
  total: number;
  status: BatchStatus;
  createdBy: string;
  createdAt: string;
  endedAt: string | null;
  /** Laps saved so far, and how many of them finished. */
  done: number;
  finished: number;
}

export type NewBatch = Pick<Batch, "modelIds" | "trackIds" | "seeds" | "errorLevels" | "draws">;

/** Every saved lap of one model on one track at one driver-error level. */
export interface BenchmarkCell {
  modelId: string;
  trackId: string;
  errorLevel: number;
  laps: number;
  finished: number;
  medianSteps: number | null;
  bestSteps: number | null;
}

export type NewDrive = Pick<Drive, "modelId" | "trackId" | "seed" | "errorLevel" | "noiseSeed" | "status" | "steps" | "gatesPassed" | "hash"> & {
  ghostModelId?: string;
  sectorEnds?: number[];
  batchId?: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `The server answered ${res.status}.`, res.status);
  return body;
}

export const api = {
  me: () => call<{ user: string }>("/api/me"),
  login: (user: string, password: string) => call<{ user: string }>("/api/login", { method: "POST", body: JSON.stringify({ user, password }) }),
  logout: () => call<{ ok: true }>("/api/logout", { method: "POST" }),
  models: () => call<{ models: ModelSummary[] }>("/api/models").then((r) => r.models),
  model: (id: string) => call<Model>(`/api/models/${encodeURIComponent(id)}`),
  updateModel: (id: string, patch: { name?: string; status?: ModelStatus; notes?: string | null }) =>
    call<ModelSummary>(`/api/models/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  tracks: () => call<{ tracks: TrackSummary[] }>("/api/tracks").then((r) => r.tracks),
  track: (id: string) => call<TrackSummary & { data: TrackFile }>(`/api/tracks/${encodeURIComponent(id)}`),
  runs: () => call<{ runs: TrainingRun[] }>("/api/runs").then((r) => r.runs),
  run: (id: string) => call<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  drives: (f: { model?: string; track?: string; status?: string; batch?: number; limit?: number } = {}) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return call<{ drives: Drive[] }>(`/api/drives${q.size ? `?${q}` : ""}`).then((r) => r.drives);
  },
  drive: (id: number) => call<Drive>(`/api/drives/${id}`),
  saveDrive: (d: NewDrive) => call<Drive>("/api/drives", { method: "POST", body: JSON.stringify(d) }),
  batches: () => call<{ batches: Batch[] }>("/api/batches").then((r) => r.batches),
  batch: (id: number) => call<Batch>(`/api/batches/${id}`),
  createBatch: (b: NewBatch) => call<Batch>("/api/batches", { method: "POST", body: JSON.stringify(b) }),
  setBatchStatus: (id: number, status: BatchStatus) => call<Batch>(`/api/batches/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  benchmarks: () => call<{ cells: BenchmarkCell[] }>("/api/benchmarks").then((r) => r.cells),
  updateRun: (id: string, patch: { status?: RunStatus; notes?: string | null }) =>
    call<TrainingRun>(`/api/runs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
};

/** Load once per key; `reload` refetches. */
export function useApi<T>(load: () => Promise<T>, key: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    load().then(
      (d) => live && setData(d),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  return { data, setData, error, reload: () => setN((x) => x + 1) };
}
