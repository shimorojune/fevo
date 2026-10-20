/**
 * Runs a batch in this tab: every lap it still needs, a few at a time on the batch workers, each
 * saved as a drive tagged with the batch. One runner for the whole app, so moving between pages
 * doesn't stop it. Closing the tab does; the batch then shows as interrupted and resumes from the
 * laps already saved.
 */
import { useSyncExternalStore } from "react";
import { driveSummary, POOL_SIZE } from "@/sim/client";
import { api, type Batch, type Model } from "./api";

export interface Job {
  modelId: string;
  trackId: string;
  seed: number;
  errorLevel: number;
}

const keyOf = (j: Job) => `${j.modelId}|${j.trackId}|${j.seed}|${j.errorLevel}`;

/** Every lap a batch runs, in order: 0% once per seed (the same lap every time), `draws` per seed with error on. */
export function jobsOf(b: Pick<Batch, "modelIds" | "trackIds" | "seeds" | "errorLevels" | "draws">): Job[] {
  const out: Job[] = [];
  for (const modelId of b.modelIds)
    for (const trackId of b.trackIds)
      for (const seed of b.seeds)
        for (const errorLevel of b.errorLevels) for (let d = 0; d < (errorLevel === 0 ? 1 : b.draws); d++) out.push({ modelId, trackId, seed, errorLevel });
  return out;
}

/** The laps a batch still needs, after the ones it has saved. */
async function remaining(b: Batch): Promise<Job[]> {
  const saved = new Map<string, number>();
  for (const d of await api.drives({ batch: b.id, limit: 50_000 })) {
    const k = keyOf(d);
    saved.set(k, (saved.get(k) ?? 0) + 1);
  }
  return jobsOf(b).filter((j) => {
    const k = keyOf(j);
    const n = saved.get(k) ?? 0;
    if (n > 0) saved.set(k, n - 1);
    return n === 0;
  });
}

export interface RunnerState {
  /** The batch this tab is running, or last ran. */
  batchId: number | null;
  active: boolean;
  error: string | null;
}

let state: RunnerState = { batchId: null, active: false, error: null };
let queue: Job[] = [];
let loops = 0;
const agents = new Map<string, Promise<Model>>();
const subs = new Set<() => void>();
const set = (p: Partial<RunnerState>) => {
  state = { ...state, ...p };
  for (const s of subs) s();
};

const agent = (id: string) => {
  if (!agents.has(id)) agents.set(id, api.model(id).catch((e: unknown) => (agents.delete(id), Promise.reject(e))));
  return agents.get(id)!;
};

async function loop(slot: number, batchId: number) {
  loops++;
  try {
    while (state.active && state.batchId === batchId && queue.length) {
      const j = queue.shift()!;
      try {
        const m = await agent(j.modelId);
        // With error on, every lap draws new mistakes; the seed is kept so the lap replays exactly.
        const noiseSeed = j.errorLevel === 0 ? 0 : Math.floor(Math.random() * 2 ** 31);
        const { lap, ends } = await driveSummary(slot, { rulesId: m.rulesId, trackId: j.trackId, seed: j.seed, errorLevel: j.errorLevel, noiseSeed, agentText: m.agent });
        const save = () =>
          api.saveDrive({ ...j, noiseSeed, status: lap.status, steps: lap.steps, gatesPassed: lap.gatesPassed, hash: lap.hash, sectorEnds: ends, batchId });
        await save().catch(() => new Promise((r) => setTimeout(r, 1500)).then(save));
      } catch (e) {
        queue.unshift(j);
        if (state.active) {
          set({ active: false, error: e instanceof Error ? e.message : String(e) });
          await api.setBatchStatus(batchId, "paused").catch(() => {});
        }
      }
    }
  } finally {
    loops--;
    if (!loops && state.batchId === batchId && state.active) set({ active: false });
  }
}

export const runner = {
  /** Start or resume a batch in this tab. */
  async run(b: Batch) {
    if (state.active) throw new Error(`Batch #${state.batchId} is still running in this tab.`);
    set({ batchId: b.id, active: true, error: null });
    try {
      queue = await remaining(b);
      if (b.status !== "running") await api.setBatchStatus(b.id, "running");
    } catch (e) {
      set({ active: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (!queue.length) {
      set({ active: false });
      return;
    }
    for (let i = 0; i < Math.min(POOL_SIZE, queue.length); i++) void loop(i, b.id);
  },
  /** Stop handing out laps; the ones under way still finish and save. */
  async pause(id: number) {
    if (state.batchId === id) set({ active: false });
    await api.setBatchStatus(id, "paused");
  },
  async stop(id: number) {
    if (state.batchId === id) {
      queue = [];
      set({ active: false });
    }
    await api.setBatchStatus(id, "stopped");
  },
  isRunning: (id: number) => state.active && state.batchId === id,
};

export function useRunner(): RunnerState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
}

// Leaving the page with a batch running: ask first, since the laps stop with the tab.
addEventListener("beforeunload", (e) => {
  if (state.active) e.preventDefault();
});
