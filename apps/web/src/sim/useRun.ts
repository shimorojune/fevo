import { useEffect, useState } from "react";
import type { AgentError } from "@fevo/agent-format";
import type { LapResult } from "@fevo/sim";
import { runAgent } from "./client";
import type { AgentSummary } from "./protocol";

export interface RunState {
  phase: "idle" | "checking" | "rejected" | "running" | "done" | "failed";
  checkMs?: number;
  summary?: AgentSummary;
  errors?: AgentError[];
  laps: LapResult[];
  medianSteps: number | null;
  ranked: boolean;
  message?: string;
}

const IDLE: RunState = { phase: "idle", laps: [], medianSteps: null, ranked: false };

/** Check an agent and run its three official laps in the worker whenever the inputs change. */
export function useRun(trackId: string | undefined, agentText: string | undefined): RunState {
  const [state, setState] = useState<RunState>(IDLE);
  useEffect(() => {
    if (!trackId || agentText === undefined) {
      setState(IDLE);
      return;
    }
    setState({ ...IDLE, phase: "checking" });
    return runAgent(trackId, agentText, (m) => {
      setState((s) => {
        switch (m.type) {
          case "checked":
            return m.ok
              ? { ...s, phase: "running", checkMs: m.ms, summary: m.summary }
              : { ...s, phase: "rejected", checkMs: m.ms, errors: m.errors };
          case "lap":
            return { ...s, laps: [...s.laps, m.lap] };
          case "done":
            return { ...s, phase: "done", medianSteps: m.medianSteps, ranked: m.ranked };
          case "failed":
            return { ...s, phase: "failed", message: m.message };
        }
      });
    });
  }, [trackId, agentText]);
  return state;
}
