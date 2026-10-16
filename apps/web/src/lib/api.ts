/**
 * The fevo API. In dev, Vite proxies /api to the API server (apps/api);
 * in production set VITE_API_URL if the API lives on another origin.
 */
import type { LapResult } from "@fevo/sim";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type SubmissionStatus = "queued" | "verified" | "unranked" | "mismatch" | "failed";

export interface Submission {
  id: string;
  driver: string;
  circuit: string;
  fingerprint: string;
  status: SubmissionStatus;
  detail: string | null;
  medianSteps: number | null;
  lapTime: string | null;
}

export interface BoardEntry {
  rank: number;
  id: string;
  driver: string;
  fingerprint: string;
  kind: "neat-genome" | "mlp";
  parameters: number;
  medianSteps: number;
  lapTime: string;
  createdAt: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body;
}

/** Submit an agent with the laps this browser ran, so the server can check it gets the same ones. */
export function submitAgent(driver: string, circuit: string, agent: string, laps: LapResult[]) {
  const claimed = laps.map(({ seed, status, steps, hash }) => ({ seed, status, steps, hash }));
  return call<{ duplicate: boolean; submission: Submission }>("/api/submissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ driver, circuit, agent, claimed }),
  });
}

export const getSubmission = (id: string) => call<Submission>(`/api/submissions/${encodeURIComponent(id)}`);

export const getLeaderboard = (circuit: string) => call<{ entries: BoardEntry[] }>(`/api/leaderboard/${encodeURIComponent(circuit)}`);
