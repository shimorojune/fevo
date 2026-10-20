/**
 * Laps resampled against distance, every 5 m, so two drivers line up corner by corner
 * the way F1 telemetry overlays do.
 */
import type { LapTrace } from "@fevo/sim";
import { distance, sample, stepAt } from "./lap";

export const STEP_M = 5;

export interface Series {
  /** Distance of each sample, metres. */
  d: number[];
  /** Fractional step of each driver at that distance. */
  fa: number[];
  fb: number[] | null;
  speedA: number[];
  speedB: number[] | null;
  throttleA: number[];
  throttleB: number[] | null;
  brakeA: number[];
  brakeB: number[] | null;
  steerA: number[];
  steerB: number[] | null;
  /** Seconds the ghost is behind (+) or ahead (−) at each distance. */
  gap: number[] | null;
  length: number;
  distA: Float64Array;
}

export function series(a: LapTrace, b: LapTrace | undefined, hz: number): Series {
  const distA = distance(a);
  const distB = b ? distance(b) : null;
  const length = Math.min(distA[distA.length - 1]!, distB ? distB[distB.length - 1]! : Infinity);
  const d: number[] = [];
  for (let x = 0; x <= length; x += STEP_M) d.push(x);
  const fa = d.map((x) => stepAt(distA, x));
  const fb = distB ? d.map((x) => stepAt(distB, x)) : null;
  const of = (t: LapTrace | undefined, F: number[] | null, key: keyof LapTrace, g: (v: number) => number) => (t && F ? F.map((f) => g(sample(t[key], f))) : null);
  return {
    d,
    fa,
    fb,
    speedA: of(a, fa, "speed", (v) => v * 3.6)!,
    speedB: of(b, fb, "speed", (v) => v * 3.6),
    throttleA: of(a, fa, "throttle", (v) => Math.max(0, v) * 100)!,
    throttleB: of(b, fb, "throttle", (v) => Math.max(0, v) * 100),
    brakeA: of(a, fa, "throttle", (v) => Math.max(0, -v) * 100)!,
    brakeB: of(b, fb, "throttle", (v) => Math.max(0, -v) * 100),
    steerA: of(a, fa, "steer", (v) => v)!,
    steerB: of(b, fb, "steer", (v) => v),
    gap: fb ? d.map((_, k) => (fb[k]! - fa[k]!) / hz) : null,
    length,
    distA,
  };
}

/** Sample index nearest the lead car at step f. */
export const indexAt = (s: Series, f: number) => Math.max(0, Math.min(s.d.length - 1, Math.round(sample(s.distA, Math.min(f, s.distA.length - 1)) / STEP_M)));

export const PLASMA = ["#0d0887", "#5b02a3", "#9a179b", "#cb4678", "#eb7852", "#fbb32f", "#f0f921"];
export function plasma(t: number): string {
  const u = Math.max(0, Math.min(1, t)) * (PLASMA.length - 1);
  const i = Math.min(PLASMA.length - 2, Math.floor(u));
  const p = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const x = p(PLASMA[i]!);
  const y = p(PLASMA[i + 1]!);
  return `rgb(${x.map((v, j) => Math.round(v + (y[j]! - v) * (u - i))).join(",")})`;
}
