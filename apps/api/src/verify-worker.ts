/** Verifier worker: one wasm instance, one job at a time. */
import { parentPort } from "node:worker_threads";
import { verify, type VerifyJob } from "./verify.ts";

parentPort!.on("message", ({ id, job }: { id: number; job: VerifyJob }) => {
  try {
    parentPort!.postMessage({ id, ok: true, result: verify(job) });
  } catch (err) {
    parentPort!.postMessage({ id, ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});
