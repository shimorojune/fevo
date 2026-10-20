/**
 * Re-runs a model's official laps on one track and compares them with the
 * laps fevo publish reported. Pure and synchronous: it runs inside a verifier
 * worker, which owns its own wasm instance.
 */
import { parseAgent } from "@fevo/agent-format";
import { runOfficialLaps, type LapResult } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";
import { agentShape, RULES_BY_ID } from "./rules.ts";

/** One lap as the publisher reported it. */
export interface ClaimedLap {
  seed: number;
  status: string;
  steps: number;
  hash: string;
}

export type ServerLap = Omit<LapResult, "trace">;

export interface Verification {
  laps: ServerLap[];
  medianSteps: number | null;
  /** The first difference from the claimed laps, if any. */
  mismatch?: string;
}

export interface VerifyJob {
  rulesId: string;
  track: TrackFile;
  agentText: string;
  claimed?: ClaimedLap[] | undefined;
}

export function verify(job: VerifyJob): Verification {
  const rules = RULES_BY_ID.get(job.rulesId);
  if (!rules) throw new Error(`unknown rules ${job.rulesId}`);
  const parsed = parseAgent(job.agentText, agentShape(rules));
  if (!parsed.ok) throw new Error(`agent no longer parses: ${parsed.errors[0]?.message}`);
  const official = runOfficialLaps(rules, job.track, parsed.program);
  const mismatch = job.claimed ? compare(official.laps, job.claimed) : undefined;
  return { laps: official.laps, medianSteps: official.medianSteps, ...(mismatch ? { mismatch } : {}) };
}

/** The first difference between server and claimed laps, or undefined if they're identical. */
export function compare(server: readonly ServerLap[], claimed: readonly ClaimedLap[]): string | undefined {
  if (claimed.length !== server.length) return `expected ${server.length} laps, got ${claimed.length}`;
  for (const s of server) {
    const c = claimed.find((l) => l.seed === s.seed);
    if (!c) return `no lap for seed ${s.seed + 1}`;
    if (c.status !== s.status || c.steps !== s.steps || c.hash !== s.hash) {
      return `seed ${s.seed + 1}: server ${s.status} in ${s.steps} steps (${s.hash}), publisher ${c.status} in ${c.steps} steps (${c.hash})`;
    }
  }
  return undefined;
}
