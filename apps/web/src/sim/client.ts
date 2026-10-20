import type { LapResult } from "@fevo/sim";
import type { DriveRequest, Response } from "./protocol";

let nextId = 1;
const listeners = new Map<number, (m: Response) => void>();

function spawn(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<Response>) => listeners.get(e.data.id)?.(e.data);
  return w;
}

let worker: Worker | null = null;
const get = () => (worker ??= spawn());

/** Drive one lap (and the ghost's) in the worker. Resolves with both traced laps. */
export function driveLap(req: Omit<DriveRequest, "id" | "type">): Promise<{ model: LapResult; ghost?: LapResult }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const out: { model?: LapResult; ghost?: LapResult } = {};
    listeners.set(id, (m) => {
      if (m.type === "lap") out[m.who] = m.lap;
      else {
        listeners.delete(id);
        if (m.type === "failed") reject(new Error(m.message));
        else resolve(out as { model: LapResult; ghost?: LapResult });
      }
    });
    get().postMessage({ ...req, id, type: "drive" } satisfies DriveRequest);
  });
}

/** Workers for batches, kept apart from the one the lap view uses so a batch never holds it up. */
export const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
const pool: Worker[] = [];

/** Drive one lap on pool worker `slot` and return its result and mini-sector ends, without the trace. */
export function driveSummary(slot: number, req: Omit<DriveRequest, "id" | "type" | "summary" | "ghostAgentText" | "ghostRulesId">): Promise<{ lap: LapResult; ends: number[] }> {
  const id = nextId++;
  const w = (pool[slot] ??= spawn());
  return new Promise((resolve, reject) => {
    listeners.set(id, (m) => {
      if (m.type === "summary") {
        listeners.delete(id);
        resolve({ lap: m.lap, ends: m.ends });
      } else if (m.type === "failed") {
        listeners.delete(id);
        reject(new Error(m.message));
      }
    });
    w.postMessage({ ...req, id, type: "drive", summary: true } satisfies DriveRequest);
  });
}
