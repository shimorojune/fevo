/**
 * A fixed set of verifier workers. Each worker has its own sim.wasm instance
 * (the wasm keeps global state), so laps never share memory across jobs that
 * run at the same time.
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Verification, VerifyJob } from "./verify.ts";

type Reply = { id: number; ok: true; result: Verification } | { id: number; ok: false; message: string };

interface Pending {
  id: number;
  job: VerifyJob;
  resolve: (v: Verification) => void;
  reject: (e: Error) => void;
}

export interface Verifier {
  verify(job: VerifyJob): Promise<Verification>;
  close(): Promise<void>;
}

export function createPool(size = Math.max(1, availableParallelism() - 1)): Verifier {
  const idle: Worker[] = [];
  const busy = new Map<Worker, Pending>();
  const queue: Pending[] = [];
  let nextId = 0;

  const dispatch = () => {
    while (idle.length && queue.length) {
      const w = idle.pop()!;
      const p = queue.shift()!;
      busy.set(w, p);
      w.postMessage({ id: p.id, job: p.job });
    }
  };

  const spawn = () => {
    const w = new Worker(new URL("./verify-worker.ts", import.meta.url));
    w.on("message", (r: Reply) => {
      const p = busy.get(w);
      busy.delete(w);
      idle.push(w);
      if (p && p.id === r.id) r.ok ? p.resolve(r.result) : p.reject(new Error(r.message));
      dispatch();
    });
    w.on("error", (err) => {
      // A crashed worker takes its wasm instance with it; replace it.
      const p = busy.get(w);
      busy.delete(w);
      p?.reject(err);
      spawn();
      dispatch();
    });
    idle.push(w);
  };
  for (let i = 0; i < size; i++) spawn();

  return {
    verify: (job) =>
      new Promise((resolve, reject) => {
        queue.push({ id: nextId++, job, resolve, reject });
        dispatch();
      }),
    close: async () => {
      await Promise.all([...idle, ...busy.keys()].map((w) => w.terminate()));
    },
  };
}
