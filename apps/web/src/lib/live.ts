/**
 * Live updates from the API: one server-sent events connection for the whole
 * app, shared by every page that listens. EventSource reconnects on its own.
 */
import { useEffect, useRef } from "react";
import type { Drive, Metric, ModelSummary, TrainingRun } from "./api";

export type LiveEvent =
  | { type: "model"; model: ModelSummary }
  | { type: "run"; run: TrainingRun }
  | { type: "metrics"; runId: string; metrics: Metric[] }
  | { type: "drive"; drive: Drive };

type Listener = (e: LiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;

function connect() {
  if (source) return;
  source = new EventSource("/api/events");
  for (const type of ["model", "run", "metrics", "drive"] as const) {
    source.addEventListener(type, (m) => {
      const e = JSON.parse((m as MessageEvent<string>).data) as LiveEvent;
      for (const l of listeners) l(e);
    });
  }
}

/** Call `on` for every live event while the component is mounted. */
export function useLive(on: Listener) {
  const ref = useRef(on);
  ref.current = on;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    connect();
    return () => {
      listeners.delete(l);
      if (!listeners.size) {
        source?.close();
        source = null;
      }
    };
  }, []);
}
