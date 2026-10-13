/**
 * Racing line and quasi-steady-state lap time.
 *
 * The line minimises summed squared curvature within the track edges (less a
 * margin for the car's width), by repeated local smoothing of each point's
 * offset along its track normal. That's the classic minimum-curvature line:
 * not the exact minimum-time line, but within a few percent of it.
 */
import type { CarParams } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";

export interface Line {
  x: Float64Array;
  y: Float64Array;
  /** Offset from the centre line along the left normal, metres. */
  offset: Float64Array;
}

function normals(t: TrackFile) {
  const n = t.widthLeft.length;
  const c = t.centerline;
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n;
    const q = (i + 1) % n;
    const tx = c[2 * q]! - c[2 * p]!;
    const ty = c[2 * q + 1]! - c[2 * p + 1]!;
    const len = Math.hypot(tx, ty);
    nx[i] = -ty / len;
    ny[i] = tx / len;
  }
  return { nx, ny };
}

export function centreLine(t: TrackFile): Line {
  const n = t.widthLeft.length;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = t.centerline[2 * i]!;
    y[i] = t.centerline[2 * i + 1]!;
  }
  return { x, y, offset: new Float64Array(n) };
}

export function racingLine(t: TrackFile, margin: number, opts: { step?: number; iterations?: number } = {}): Line {
  // Solve on a coarse copy (every `step` points), then interpolate offsets back.
  const step = opts.step ?? 4;
  const iterations = opts.iterations ?? 40000;
  const n = t.widthLeft.length;
  const c = t.centerline;
  const { nx, ny } = normals(t);
  const m = Math.floor(n / step);
  const idx = Array.from({ length: m }, (_, j) => Math.round((j * n) / m) % n);
  const cx = idx.map((i) => c[2 * i]!);
  const cy = idx.map((i) => c[2 * i + 1]!);
  const nnx = idx.map((i) => nx[i]!);
  const nny = idx.map((i) => ny[i]!);
  const lo = idx.map((i) => -(t.widthRight[i]! - margin));
  const hi = idx.map((i) => t.widthLeft[i]! - margin);
  const o = new Float64Array(m);
  const px = (j: number) => cx[(j + m) % m]! + nnx[(j + m) % m]! * o[(j + m) % m]!;
  const py = (j: number) => cy[(j + m) % m]! + nny[(j + m) % m]! * o[(j + m) % m]!;
  // Projected Gauss-Seidel on sum |p[j-1] - 2 p[j] + p[j+1]|^2: the minimiser
  // for point j alone is (4 (p[j-1] + p[j+1]) - (p[j-2] + p[j+2])) / 6.
  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < m; j++) {
      const tx = (4 * (px(j - 1) + px(j + 1)) - (px(j - 2) + px(j + 2))) / 6;
      const ty = (4 * (py(j - 1) + py(j + 1)) - (py(j - 2) + py(j + 2))) / 6;
      const target = (tx - cx[j]!) * nnx[j]! + (ty - cy[j]!) * nny[j]!;
      o[j] = Math.min(hi[j]!, Math.max(lo[j]!, target));
    }
  }
  // Back to every centre-line point, linear in between coarse points.
  const off = new Float64Array(n);
  for (let j = 0; j < m; j++) {
    const a = idx[j]!;
    const bIdx = idx[(j + 1) % m]!;
    const span = (bIdx - a + n) % n;
    for (let s = 0; s < span; s++) {
      const u = s / span;
      const i = (a + s) % n;
      off[i] = Math.min(t.widthLeft[i]! - margin, Math.max(-(t.widthRight[i]! - margin), o[j]! * (1 - u) + o[(j + 1) % m]! * u));
    }
  }
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = c[2 * i]! + nx[i]! * off[i]!;
    y[i] = c[2 * i + 1]! + ny[i]! * off[i]!;
  }
  return { x, y, offset: off };
}

/** Unsigned curvature from the circle through each point and its neighbours `h` away. */
export function curvature(line: Line, h = 3): Float64Array {
  const n = line.x.length;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - h + n) % n;
    const b = (i + h) % n;
    const ax = line.x[a]!, ay = line.y[a]!;
    const bx = line.x[i]!, by = line.y[i]!;
    const cx = line.x[b]!, cy = line.y[b]!;
    const area2 = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    const d = Math.hypot(bx - ax, by - ay) * Math.hypot(cx - bx, cy - by) * Math.hypot(cx - ax, cy - ay);
    k[i] = d > 0 ? (2 * area2) / d : 0;
  }
  return k;
}

export interface Qss {
  speed: Float64Array;
  lapS: number;
}

/** Point-mass lap along a line: grip + downforce in corners, power/traction and brakes on the straights, friction circle. */
export function qssLap(line: Line, car: CarParams): Qss {
  const n = line.x.length;
  const k = curvature(line);
  const ds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = (i + 1) % n;
    ds[i] = Math.hypot(line.x[q]! - line.x[i]!, line.y[q]! - line.y[i]!);
  }
  const m = car.massKg;
  const g = car.gravityMps2;
  const b = car.wheelbaseM - car.cgToFrontM;
  const loads = (v: number) => {
    const df = 0.5 * car.airDensityKgM3 * car.downforceAreaM2 * v * v;
    return [(m * g * b) / car.wheelbaseM + df * car.aeroBalanceFront, (m * g * car.cgToFrontM) / car.wheelbaseM + df * (1 - car.aeroBalanceFront)] as const;
  };
  const latCap = (v: number) => {
    const [f, r] = loads(v);
    return car.tyreMuFront * f + car.tyreMuRear * r;
  };
  const spare = (v: number, ki: number) => {
    const cap = latCap(v);
    const need = m * v * v * ki;
    return Math.sqrt(Math.max(0, 1 - (need / cap) ** 2));
  };
  const drag = (v: number) => 0.5 * car.airDensityKgM3 * car.dragAreaM2 * v * v + car.rollingResistance * m * g;
  const vmax = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let v = 90;
    for (let it = 0; it < 40; it++) v = Math.min(110, Math.sqrt(latCap(v) / m / Math.max(k[i]!, 1e-6)));
    vmax[i] = v;
  }
  // Flying lap: two passes of acceleration and braking round the loop.
  const v = Float64Array.from(vmax);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < n; j++) {
      const i = j;
      const q = (i + 1) % n;
      const [, fzr] = loads(v[i]!);
      const drive = Math.min(car.powerW / Math.max(v[i]!, 1), car.tyreMuRear * fzr * spare(v[i]!, k[i]!));
      const acc = (drive - drag(v[i]!)) / m;
      v[q] = Math.min(v[q]!, Math.sqrt(Math.max(0, v[i]! ** 2 + 2 * acc * ds[i]!)));
    }
    for (let j = n - 1; j >= 0; j--) {
      const i = j;
      const q = (i + 1) % n;
      const [ff, fr] = loads(v[q]!);
      const brake = Math.min(car.maxBrakeForceN, car.tyreMuFront * ff + car.tyreMuRear * fr) * spare(v[q]!, k[q]!);
      const dec = (brake + drag(v[q]!)) / m;
      v[i] = Math.min(v[i]!, Math.sqrt(v[q]! ** 2 + 2 * dec * ds[i]!));
    }
  }
  let t = 0;
  for (let i = 0; i < n; i++) t += ds[i]! / Math.max(0.5, (v[i]! + v[(i + 1) % n]!) / 2);
  return { speed: v, lapS: t };
}
