import type { LapResult } from "@fevo/sim";

/** One lap to drive in the worker: the model, and optionally a ghost model on the same seed. */
export interface DriveRequest {
  id: number;
  type: "drive";
  rulesId: string;
  trackId: string;
  seed: number;
  errorLevel: number;
  noiseSeed: number;
  agentText: string;
  ghostAgentText?: string | undefined;
  ghostRulesId?: string | undefined;
}

export type Request = DriveRequest;

export type Response =
  | { id: number; type: "lap"; who: "model" | "ghost"; lap: LapResult }
  | { id: number; type: "done" }
  | { id: number; type: "failed"; message: string };
