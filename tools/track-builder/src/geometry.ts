/** One centreline point with distances to each edge, metres. */
export interface Sample {
  x: number;
  y: number;
  wRight: number;
  wLeft: number;
}

/**
 * Parse a TUMFTM racetrack-database CSV:
 * `# x_m,y_m,w_tr_right_m,w_tr_left_m` then one point per line.
 */
export function parseTumftmCsv(text: string): Sample[] {
  const out: Sample[] = [];
  text.split(/\r?\n/).forEach((raw, lineNo) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const parts = line.split(",").map((s) => Number(s.trim()));
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
      throw new Error(`line ${lineNo + 1}: expected 4 numbers, got "${line}"`);
    }
    const [x, y, wRight, wLeft] = parts as [number, number, number, number];
    if (wRight <= 0 || wLeft <= 0) throw new Error(`line ${lineNo + 1}: non-positive width`);
    out.push({ x, y, wRight, wLeft });
  });
  if (out.length < 3) throw new Error("need at least 3 points");
  return dropClosingDuplicate(out);
}

function dropClosingDuplicate(s: Sample[]): Sample[] {
  const first = s[0]!;
  const last = s[s.length - 1]!;
  return Math.hypot(last.x - first.x, last.y - first.y) < 1e-6 ? s.slice(0, -1) : s;
}

/** Length of the closed loop through the samples. */
export function loopLength(s: readonly Sample[]): number {
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const a = s[i]!;
    const b = s[(i + 1) % s.length]!;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/**
 * Resample a closed loop to evenly spaced points by arc length. Position
 * follows a centripetal Catmull-Rom spline through the source points, so the
 * result has no kinks at source vertices; widths are interpolated linearly.
 * Spacing is adjusted so the loop divides exactly. Sample 0 is kept in place.
 */
export function resampleClosed(s: readonly Sample[], targetSpacingM: number): { samples: Sample[]; spacingM: number } {
  return resampleLinear(densifyCatmullRom(s, SUBDIVISIONS), targetSpacingM);
}

/** Spline points per source segment before arc-length resampling. */
const SUBDIVISIONS = 32;

/** Centripetal Catmull-Rom (alpha 0.5) through every point of a closed loop. */
export function densifyCatmullRom(s: readonly Sample[], subdivisions: number): Sample[] {
  const n = s.length;
  const out: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = s[(i - 1 + n) % n]!;
    const p1 = s[i]!;
    const p2 = s[(i + 1) % n]!;
    const p3 = s[(i + 2) % n]!;
    const t1 = knot(0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    for (let k = 0; k < subdivisions; k++) {
      const u = k / subdivisions;
      const t = t1 + (t2 - t1) * u;
      const [x, y] = barryGoldman(p0, p1, p2, p3, 0, t1, t2, t3, t);
      out.push({ x, y, wRight: p1.wRight + (p2.wRight - p1.wRight) * u, wLeft: p1.wLeft + (p2.wLeft - p1.wLeft) * u });
    }
  }
  return out;
}

function knot(t: number, a: Sample, b: Sample): number {
  // Coincident points would give a zero-length knot interval.
  return t + Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-6);
}

function barryGoldman(
  p0: Sample,
  p1: Sample,
  p2: Sample,
  p3: Sample,
  t0: number,
  t1: number,
  t2: number,
  t3: number,
  t: number,
): [number, number] {
  const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
    const wa = (tb - t) / (tb - ta);
    const wb = (t - ta) / (tb - ta);
    return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb];
  };
  const P0: [number, number] = [p0.x, p0.y];
  const P1: [number, number] = [p1.x, p1.y];
  const P2: [number, number] = [p2.x, p2.y];
  const P3: [number, number] = [p3.x, p3.y];
  const a1 = lerp(P0, P1, t0, t1);
  const a2 = lerp(P1, P2, t1, t2);
  const a3 = lerp(P2, P3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** Evenly spaced points along the closed polyline, linear interpolation. */
export function resampleLinear(s: readonly Sample[], targetSpacingM: number): { samples: Sample[]; spacingM: number } {
  const n = s.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = s[i]!;
    const b = s[(i + 1) % n]!;
    cum[i + 1] = cum[i]! + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n]!;
  const count = Math.max(3, Math.round(total / targetSpacingM));
  const spacingM = total / count;
  const samples: Sample[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const d = k * spacingM;
    while (j < n - 1 && cum[j + 1]! <= d) j++;
    const a = s[j]!;
    const b = s[(j + 1) % n]!;
    const segLen = cum[j + 1]! - cum[j]!;
    const t = segLen > 0 ? (d - cum[j]!) / segLen : 0;
    samples.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      wRight: a.wRight + (b.wRight - a.wRight) * t,
      wLeft: a.wLeft + (b.wLeft - a.wLeft) * t,
    });
  }
  return { samples, spacingM };
}

/** Positive when the loop runs counter-clockwise (y up). */
export function signedArea(s: readonly Sample[]): number {
  let a = 0;
  for (let i = 0; i < s.length; i++) {
    const p = s[i]!;
    const q = s[(i + 1) % s.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Signed curvature per sample (1/m, positive turning left), from heading change. */
export function curvature(s: readonly Sample[]): Float64Array {
  const n = s.length;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = s[(i - 1 + n) % n]!;
    const c = s[i]!;
    const q = s[(i + 1) % n]!;
    const h1 = Math.atan2(c.y - p.y, c.x - p.x);
    const h2 = Math.atan2(q.y - c.y, q.x - c.x);
    const ds = (Math.hypot(c.x - p.x, c.y - p.y) + Math.hypot(q.x - c.x, q.y - c.y)) / 2;
    k[i] = ds > 0 ? wrapAngle(h2 - h1) / ds : 0;
  }
  return k;
}

/** Moving average of curvature over ±halfWindow samples, wrapping around the loop. */
export function smoothedCurvature(s: readonly Sample[], halfWindow: number): Float64Array {
  const k = curvature(s);
  const n = k.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -halfWindow; j <= halfWindow; j++) sum += k[(i + j + n) % n]!;
    out[i] = sum / (2 * halfWindow + 1);
  }
  return out;
}

/**
 * Curvature is averaged over this many metres either side before fold checks,
 * so survey noise in the source line doesn't read as a corner.
 */
export const FOLD_WINDOW_M = 3;

/**
 * Samples where the inside edge folds over itself: the inside width is at
 * least the corner radius, so the offset edge would self-intersect.
 */
export function foldedSamples(s: readonly Sample[], spacingM = 1): number[] {
  const k = smoothedCurvature(s, Math.max(1, Math.round(FOLD_WINDOW_M / spacingM)));
  const out: number[] = [];
  s.forEach((p, i) => {
    const ki = k[i]!;
    const inside = ki > 0 ? p.wLeft : p.wRight;
    if (Math.abs(ki) * inside >= 1) out.push(i);
  });
  return out;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function roundMm(v: number): number {
  return Math.round(v * 1000) / 1000;
}
