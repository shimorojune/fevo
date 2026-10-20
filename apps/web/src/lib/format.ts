import { circuitBrand } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";

export const HZ = R.timing.agentHz;

/** m:ss.hh from simulator steps. */
export function lapTime(steps: number): string {
  const cs = Math.round((steps / HZ) * 100);
  return `${Math.floor(cs / 6000)}:${((cs % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}

export function gap(steps: number, ref: number): string {
  const d = (steps - ref) / HZ;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}`;
}

export const km = (m: number) => `${(m / 1000).toFixed(3)} km`;

export const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  finished: "Finished",
  crashed: "Crashed",
  stopped: "Stopped",
  error: "Error",
  "timed-out": "Timed out",
};

/** Display name for a track: the API's name, else the branded name for baked circuits, else the id. */
export function trackName(id: string, tracks?: readonly { id: string; name: string }[]): string {
  const t = tracks?.find((x) => x.id === id);
  if (t) return t.name;
  try {
    return circuitBrand(id).name;
  } catch {
    return id;
  }
}
