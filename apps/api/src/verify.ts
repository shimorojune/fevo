/**
 * Re-runs a submission's official laps and compares them with what the
 * submitter's browser reported. Pure and synchronous: it runs inside a
 * verifier worker, which owns its own wasm instance.
 */
import { parseAgent } from "@fevo/agent-format";
import { runOfficialLaps, type LapResult } from "@fevo/sim";
import { agentShape, RULES, trackFor } from "./season.ts";

/** One lap as the browser reported it. */
export interface ClaimedLap {
  seed: number;
  status: string;
  steps: number;
  hash: string;
}

export type ServerLap = Omit<LapResult, "trace">;

/**
 * verified: laps re-run identically and the agent is ranked.
 * unranked: laps re-run identically but fewer than two finished.
 * mismatch: the server's laps differ from the claimed ones; never ranked.
 */
export type Verdict = "verified" | "unranked" | "mismatch";

export interface Verification {
  laps: ServerLap[];
  medianSteps: number | null;
  verdict: Verdict;
  /** Why the laps didn't match, for the submitter. */
  detail?: string;
}

export interface VerifyJob {
  circuitId: string;
  agentText: string;
  claimed?: ClaimedLap[] | undefined;
}

export function verify(job: VerifyJob): Verification {
  const track = trackFor(job.circuitId);
  if (!track) throw new Error(`unknown circuit ${job.circuitId}`);
  const parsed = parseAgent(job.agentText, agentShape());
  if (!parsed.ok) throw new Error(`agent no longer parses: ${parsed.errors[0]?.message}`);
  const official = runOfficialLaps(RULES, track, parsed.program);
  const detail = job.claimed ? compare(official.laps, job.claimed) : undefined;
  if (detail) return { laps: official.laps, medianSteps: null, verdict: "mismatch", detail };
  return { laps: official.laps, medianSteps: official.medianSteps, verdict: official.ranked ? "verified" : "unranked" };
}

/** The first difference between server and claimed laps, or undefined if they're identical. */
export function compare(server: readonly ServerLap[], claimed: readonly ClaimedLap[]): string | undefined {
  if (claimed.length !== server.length) return `expected ${server.length} laps, got ${claimed.length}`;
  for (const s of server) {
    const c = claimed.find((l) => l.seed === s.seed);
    if (!c) return `no lap for seed ${s.seed + 1}`;
    if (c.status !== s.status || c.steps !== s.steps || c.hash !== s.hash) {
      return `seed ${s.seed + 1}: server ${s.status} in ${s.steps} steps (${s.hash}), browser ${c.status} in ${c.steps} steps (${c.hash})`;
    }
  }
  return undefined;
}
