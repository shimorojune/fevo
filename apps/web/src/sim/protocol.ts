import type { AgentError } from "@fevo/agent-format";
import type { LapResult } from "@fevo/sim";

export interface AgentSummary {
  kind: "neat-genome" | "mlp";
  nodes: number;
  connections: number;
  parameters: number;
  fingerprint: string;
  bytes: number;
  /** Setup values in the rules' knob order. */
  setup: number[];
}

export type Request = { id: number; type: "run"; trackId: string; agentText: string };

export type Response =
  | { id: number; type: "checked"; ok: true; summary: AgentSummary; ms: number }
  | { id: number; type: "checked"; ok: false; errors: AgentError[]; ms: number }
  | { id: number; type: "lap"; lap: LapResult }
  | { id: number; type: "done"; medianSteps: number | null; ranked: boolean }
  | { id: number; type: "failed"; message: string };
