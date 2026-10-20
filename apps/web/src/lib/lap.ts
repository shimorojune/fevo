/**
 * What the Run screen reads off a traced lap: distance along the lap, mini sectors timed at the
 * gates (as tools/replay does), F1 sector colours, and the summary numbers.
 */
import type { LapResult, LapTrace } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";
import type { Drive } from "./api";

export const MINI_SECTORS = 24;
export const PER_SECTOR = 8;

/** Gate index that ends each of the first 23 mini sectors; the 24th ends at the line. */
export const miniBounds = (gateCount: number) => Array.from({ length: MINI_SECTORS - 1 }, (_, i) => Math.round(((i + 1) * gateCount) / MINI_SECTORS));

/** Fraction of step j at which the car crossed the line across the track at centreline point gi. */
function crossFraction(t: TrackFile, gi: number, x0: number, y0: number, x1: number, y1: number): number {
  const c = t.centerline;
  const n = t.widthLeft.length;
  const a = (gi - 1 + n) % n;
  let tx = c[2 * gi]! - c[2 * a]!;
  let ty = c[2 * gi + 1]! - c[2 * a + 1]!;
  const len = Math.hypot(tx, ty);
  tx /= len;
  ty /= len;
  const mx = (c[2 * a]! + c[2 * gi]!) / 2;
  const my = (c[2 * a + 1]! + c[2 * gi + 1]!) / 2;
  const s0 = (x0 - mx) * tx + (y0 - my) * ty;
  const s1 = (x1 - mx) * tx + (y1 - my) * ty;
  return s1 > s0 ? Math.min(1, Math.max(0, -s0 / (s1 - s0))) : 1;
}

/** Step (fractional) at which each completed mini sector ended. A finished lap's last one ends at its final step. */
export function miniSectorEnds(lap: LapResult, track: TrackFile): number[] {
  const tr = lap.trace!;
  const bounds = miniBounds(track.gates.length);
  const ends: number[] = [];
  for (let j = 1, k = 0; j < tr.gates.length && k < bounds.length; j++)
    while (k < bounds.length && tr.gates[j]! >= bounds[k]!) {
      ends.push(j - 1 + crossFraction(track, track.gates[bounds[k]!]!, tr.x[j - 1]!, tr.y[j - 1]!, tr.x[j]!, tr.y[j]!));
      k++;
    }
  if (lap.status === "finished" && ends.length === bounds.length) ends.push(lap.steps);
  return ends;
}

export const durations = (ends: number[]) => ends.map((e, k) => e - (k ? ends[k - 1]! : 0));
export const sectorTimes = (mini: number[]) =>
  [0, 1, 2].map((s) => (mini.length >= (s + 1) * PER_SECTOR ? mini.slice(s * PER_SECTOR, (s + 1) * PER_SECTOR).reduce((a, b) => a + b, 0) : null));

export type F1 = "p" | "g" | "y";
/**
 * F1 timing colours. Purple: faster than every rival time and no slower than your own best.
 * Green: a new personal best. Yellow: anything else. A tie is never an improvement.
 */
export const f1 = (t: number, rivalBest: number, ownBest: number): F1 => (t < rivalBest && t <= ownBest ? "p" : t < ownBest ? "g" : "y");
export const best = (xs: (number | null | undefined)[]) => Math.min(Infinity, ...xs.filter((x): x is number => typeof x === "number"));

/** Cumulative distance along the driven line, metres, per step. */
export function distance(tr: LapTrace): Float64Array {
  const d = new Float64Array(tr.x.length);
  for (let i = 1; i < d.length; i++) d[i] = d[i - 1]! + Math.hypot(tr.x[i]! - tr.x[i - 1]!, tr.y[i]! - tr.y[i - 1]!);
  return d;
}

/** Fractional step at which a lap reached distance d. */
export function stepAt(dist: Float64Array, d: number): number {
  let lo = 0;
  let hi = dist.length - 1;
  if (d <= 0) return 0;
  if (d >= dist[hi]!) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (dist[m]! <= d) lo = m;
    else hi = m;
  }
  return lo + (d - dist[lo]!) / Math.max(1e-9, dist[hi]! - dist[lo]!);
}

export function sample(arr: ArrayLike<number>, f: number): number {
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
  const a = arr[i]!;
  const b = arr[Math.min(i + 1, arr.length - 1)]!;
  return a + (b - a) * (f - i);
}

export interface LapStats {
  topKmh: number;
  avgKmh: number;
  fullThrottle: number;
  braking: number;
  lockUps: number;
}

export function lapStats(lap: LapResult, hz: number): LapStats {
  const t = lap.trace!;
  const n = Math.max(1, lap.steps);
  let top = 0;
  let full = 0;
  let brake = 0;
  let locks = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    top = Math.max(top, t.speed[i]!);
    if (t.throttle[i]! >= 0.98) full++;
    if (t.throttle[i]! < 0) brake++;
    const l = t.frontSlide[i]! > 0 || (t.rearSlide[i]! > 0 && t.throttle[i]! < 0) ? 1 : 0;
    if (l && !prev) locks++;
    prev = l;
  }
  const d = distance(t);
  return { topKmh: top * 3.6, avgKmh: (d[d.length - 1]! / (n / hz)) * 3.6, fullThrottle: (full / n) * 100, braking: (brake / n) * 100, lockUps: locks };
}

/** Corners: points of high curvature along the centreline, at least 150 m apart, in lap order (metres from the line). */
export function corners(track: TrackFile, maxRadiusM = 150): number[] {
  const c = track.centerline;
  const n = c.length / 2;
  const span = 15;
  const k: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i - span + n) % n;
    const b = (i + span) % n;
    const ax = c[2 * a]!, ay = c[2 * a + 1]!, bx = c[2 * i]!, by = c[2 * i + 1]!, cx = c[2 * b]!, cy = c[2 * b + 1]!;
    const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(cx - bx, cy - by), ac = Math.hypot(cx - ax, cy - ay);
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    k.push(Math.abs((2 * cross) / (ab * bc * ac + 1e-9)));
  }
  const order = [...k.keys()].sort((p, q) => k[q]! - k[p]!);
  const picked: number[] = [];
  for (const i of order) {
    if (1 / Math.max(k[i]!, 1e-6) > maxRadiusM) break;
    if (picked.every((j) => Math.min(Math.abs(i - j), n - Math.abs(i - j)) > 180)) picked.push(i);
  }
  const start = track.gates[0] ?? 0;
  return picked.map((i) => (((i - start) % n) + n) % n).sort((p, q) => p - q);
}

/** Corners as fractions of the lap (0 at the line), from the centreline's arc length. */
export function cornerFractions(track: TrackFile): number[] {
  const c = track.centerline;
  const n = c.length / 2;
  const start = track.gates[0] ?? 0;
  const arc = new Float64Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const i = (start + k - 1) % n;
    const j = (start + k) % n;
    arc[k] = arc[k - 1]! + Math.hypot(c[2 * j]! - c[2 * i]!, c[2 * j + 1]! - c[2 * i + 1]!);
  }
  return corners(track).map((k) => arc[k]! / arc[n]!);
}

/** One lap's timing: mini sector and sector durations in steps, and the lap if finished. */
export interface LapTimes {
  mini: number[];
  sec: (number | null)[];
  steps: number | null;
}

export function timesOf(ends: number[] | null | undefined, finished: boolean, steps: number): LapTimes {
  const mini = durations(ends ?? []);
  return { mini, sec: sectorTimes(mini), steps: finished ? steps : null };
}

export interface Colours {
  mini: F1[];
  sec: (F1 | null)[];
  lap: F1 | null;
}

/** Colour a lap against other models' laps (rivals) and this model's other laps (own). */
export function colours(me: LapTimes, rivals: LapTimes[], own: LapTimes[]): Colours {
  return {
    mini: me.mini.map((t, k) => f1(t, best(rivals.map((r) => r.mini[k])), best(own.map((o) => o.mini[k])))),
    sec: me.sec.map((t, k) => (t === null ? null : f1(t, best(rivals.map((r) => r.sec[k])), best(own.map((o) => o.sec[k]))))),
    lap: me.steps === null ? null : f1(me.steps, best(rivals.map((r) => r.steps)), best(own.map((o) => o.steps))),
  };
}

/** Colour a lap against every saved run on the track (but `skip`, the lap itself), plus laps just driven. */
export function judge(modelId: string, me: LapTimes, drives: Pick<Drive, "id" | "modelId" | "sectorEnds" | "status" | "steps">[], extra: { modelId: string; times: LapTimes }[], skip?: number) {
  const all = [...drives.filter((d) => d.id !== skip).map((d) => ({ modelId: d.modelId, times: timesOf(d.sectorEnds, d.status === "finished", d.steps) })), ...extra];
  return colours(
    me,
    all.filter((o) => o.modelId !== modelId).map((o) => o.times),
    all.filter((o) => o.modelId === modelId).map((o) => o.times),
  );
}
