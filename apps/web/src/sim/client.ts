import type { LapResult } from "@fevo/sim";
import type { DriveRequest, Response } from "./protocol";

let worker: Worker | null = null;
let nextId = 1;
const listeners = new Map<number, (m: Response) => void>();

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<Response>) => listeners.get(e.data.id)?.(e.data);
  }
  return worker;
}

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
