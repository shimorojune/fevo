/**
 * Canvas drawing for replays: follow camera at true scale, minimap and
 * telemetry strip. Pure drawing; React owns the state.
 */
import type { LapTrace } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";

export interface Colors {
  primary: string;
  secondary: string;
  accent: string;
}

export interface TrackGeometry {
  track: TrackFile;
  left: Path2D;
  right: Path2D;
  surface: Path2D;
  gates: Path2D;
  start: Path2D;
  /** Edge points, for SVG thumbnails. */
  leftPts: [number, number][];
  rightPts: [number, number][];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const cache = new WeakMap<TrackFile, TrackGeometry>();

export function geometry(track: TrackFile): TrackGeometry {
  const hit = cache.get(track);
  if (hit) return hit;
  const n = track.widthLeft.length;
  const c = track.centerline;
  const leftPts: [number, number][] = [];
  const rightPts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n;
    const q = (i + 1) % n;
    const tx = c[2 * q]! - c[2 * p]!;
    const ty = c[2 * q + 1]! - c[2 * p + 1]!;
    const len = Math.hypot(tx, ty);
    const nx = -ty / len;
    const ny = tx / len;
    const x = c[2 * i]!;
    const y = c[2 * i + 1]!;
    leftPts.push([x + nx * track.widthLeft[i]!, y + ny * track.widthLeft[i]!]);
    rightPts.push([x - nx * track.widthRight[i]!, y - ny * track.widthRight[i]!]);
  }
  const loop = (pts: [number, number][]) => {
    const p = new Path2D();
    pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
  };
  const left = loop(leftPts);
  const right = loop(rightPts);
  const surface = new Path2D();
  surface.addPath(left);
  surface.addPath(right);
  const gates = new Path2D();
  for (const g of track.gates) {
    gates.moveTo(...leftPts[g]!);
    gates.lineTo(...rightPts[g]!);
  }
  const start = new Path2D();
  start.moveTo(...leftPts[track.gates[0]!]!);
  start.lineTo(...rightPts[track.gates[0]!]!);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [...leftPts, ...rightPts]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const g: TrackGeometry = { track, left, right, surface, gates, start, leftPts, rightPts, bounds: { minX, minY, maxX, maxY } };
  cache.set(track, g);
  return g;
}

/** SVG path of the centreline, fitted to a w × h box, for thumbnails. */
export function thumbnailPath(track: TrackFile, w: number, h: number, pad = 4): string {
  const c = track.centerline;
  const n = c.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, c[2 * i]!);
    maxX = Math.max(maxX, c[2 * i]!);
    minY = Math.min(minY, c[2 * i + 1]!);
    maxY = Math.max(maxY, c[2 * i + 1]!);
  }
  const s = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY));
  const ox = (w - (maxX - minX) * s) / 2;
  const oy = (h - (maxY - minY) * s) / 2;
  const step = Math.max(1, Math.floor(n / 300));
  let d = "";
  for (let i = 0; i < n; i += step) {
    const x = ox + (c[2 * i]! - minX) * s;
    const y = h - (oy + (c[2 * i + 1]! - minY) * s);
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + "Z";
}

const PALETTE = {
  grass: "#E6E9E2",
  asphalt: "#3B3E44",
  edge: "#FFFFFF",
  gate: "rgba(31,95,214,.30)",
  start: "#D9622B",
  trail: "rgba(31,95,214,.65)",
  ghost: "rgba(18,20,23,.55)",
  fg: "#121417",
  muted: "#586070",
  speed: "#1F5FD6",
  throttle: "#1E8E4E",
  brake: "#C2372B",
};

export function sample(arr: ArrayLike<number>, f: number): number {
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
  const k = f - i;
  const a = arr[i]!;
  const b = arr[Math.min(i + 1, arr.length - 1)]!;
  return a + (b - a) * k;
}

function sampleAngle(arr: ArrayLike<number>, f: number): number {
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(f)));
  const k = f - i;
  const a = arr[i]!;
  let d = arr[Math.min(i + 1, arr.length - 1)]! - a;
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}

/** Fit the backing store to the element's size; returns the device pixel ratio. */
export function fitCanvas(cv: HTMLCanvasElement): number {
  const r = cv.getBoundingClientRect();
  const d = window.devicePixelRatio || 1;
  const w = Math.round(r.width * d);
  const h = Math.round(r.height * d);
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
  }
  return d;
}

export const LOCK_COLOR = "#8fd0ff";
export const SPIN_COLOR = "#ff8a3d";

export interface TyreState {
  front: number;
  rear: number;
  /** Rear sliding under braking is a lock-up; on throttle it's wheelspin. */
  rearColor: string;
  label: string;
}

/** Lock-up / wheelspin at a step of a trace. */
export function tyreState(trace: LapTrace, i: number): TyreState {
  const f = trace.frontSlide?.[i] ?? 0;
  const r = trace.rearSlide?.[i] ?? 0;
  const braking = (trace.throttle[i] ?? 0) < 0;
  const label =
    f > 0 && r > 0 ? (braking ? "Lock-up, all four" : "Lock-up and wheelspin") : f > 0 ? "Front lock-up" : r > 0 ? (braking ? "Rear lock-up" : "Wheelspin") : "";
  return { front: f, rear: r, rearColor: braking ? LOCK_COLOR : SPIN_COLOR, label };
}

/** Wheel centres in car coordinates (metres from the centre of gravity). */
const WHEELS = {
  front: [
    [1.6, 0.74],
    [1.6, -0.74],
  ],
  rear: [
    [-1.75, 0.74],
    [-1.75, -0.74],
  ],
} as const;

/** Top-down F1 car in metres, nose along +x. */
function drawCar(ctx: CanvasRenderingContext2D, colors: Colors, length: number, width: number, ghost = false, ts?: TyreState): void {
  const Lh = length / 2;
  const Wh = width / 2;
  ctx.globalAlpha = ghost ? 0.45 : 1;
  if (ts && !ghost) {
    // Tyre smoke trailing behind sliding wheels.
    for (const [axle, k] of [
      ["front", ts.front],
      ["rear", ts.rear],
    ] as const) {
      if (k <= 0) continue;
      for (const [wx, wy] of WHEELS[axle]) {
        for (let j = 1; j <= 4; j++) {
          ctx.beginPath();
          ctx.arc(wx - j * 0.7, wy, 0.35 + 0.25 * j * k, 0, 2 * Math.PI);
          ctx.fillStyle = `rgba(235,240,245,${((0.35 * k) / j).toFixed(3)})`;
          ctx.fill();
        }
      }
    }
  }
  for (const [x0, x1, axle] of [
    [-2.15, -1.35, "rear"],
    [1.25, 1.95, "front"],
  ] as const) {
    const k = ts ? (axle === "front" ? ts.front : ts.rear) : 0;
    ctx.fillStyle = k > 0 && ts ? (axle === "front" ? LOCK_COLOR : ts.rearColor) : "#111";
    for (const s of [-1, 1]) ctx.fillRect(x0, s > 0 ? Wh - 0.42 : -Wh, x1 - x0, 0.42);
  }
  ctx.fillStyle = colors.secondary;
  ctx.fillRect(-Lh, -0.78, 0.38, 1.56);
  ctx.fillRect(Lh - 0.32, -Wh + 0.05, 0.32, 2 * Wh - 0.1);
  ctx.fillStyle = colors.primary;
  ctx.beginPath();
  const pts: [number, number][] = [
    [Lh - 0.2, 0.1],
    [1.3, 0.2],
    [0.7, 0.42],
    [-0.2, 0.62],
    [-1.2, 0.55],
    [-2.25, 0.28],
  ];
  ctx.moveTo(Lh - 0.05, 0);
  for (const [x, y] of pts) ctx.lineTo(x, y);
  for (const [x, y] of [...pts].reverse()) ctx.lineTo(x, -y);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0.07;
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  ctx.stroke();
  ctx.fillStyle = colors.accent;
  ctx.fillRect(-1.6, -0.08, 3.4, 0.16);
  ctx.fillStyle = "#0b0b0b";
  ctx.beginPath();
  ctx.ellipse(0.2, 0, 0.42, 0.24, 0, 0, 2 * Math.PI);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export interface Car {
  trace: LapTrace;
  colors: Colors;
  ghost?: boolean;
}

export interface MainView {
  geo: TrackGeometry;
  cars: Car[];
  frame: number;
  /** Pixels per metre (CSS px). */
  zoom: number;
  car: { length: number; width: number };
  agentHz: number;
}

export function drawMain(cv: HTMLCanvasElement, v: MainView): void {
  const ctx = cv.getContext("2d");
  if (!ctx || !v.cars.length) return;
  const d = fitCanvas(cv);
  const W = cv.width;
  const H = cv.height;
  const zoom = v.zoom * d;
  const lead = v.cars.find((c) => !c.ghost) ?? v.cars[0]!;
  const f = Math.min(v.frame, lead.trace.x.length - 1);
  const x = sample(lead.trace.x, f);
  const y = sample(lead.trace.y, f);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(zoom, 0, 0, -zoom, W / 2 - x * zoom, H / 2 + y * zoom);
  ctx.fillStyle = PALETTE.asphalt;
  ctx.fill(v.geo.surface, "evenodd");
  ctx.lineWidth = 0.3;
  ctx.strokeStyle = PALETTE.edge;
  ctx.stroke(v.geo.left);
  ctx.stroke(v.geo.right);
  ctx.lineWidth = 0.15;
  ctx.strokeStyle = PALETTE.gate;
  ctx.stroke(v.geo.gates);
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = PALETTE.start;
  ctx.stroke(v.geo.start);

  // Trail of the lead car: the last 6 seconds.
  const tr = lead.trace;
  const from = Math.max(0, Math.floor(f) - 6 * v.agentHz);
  ctx.beginPath();
  for (let i = from; i <= Math.floor(f); i++) (i === from ? ctx.moveTo : ctx.lineTo).call(ctx, tr.x[i]!, tr.y[i]!);
  ctx.lineTo(x, y);
  ctx.strokeStyle = PALETTE.trail;
  ctx.lineWidth = 0.35;
  ctx.stroke();

  // Skid marks: every sliding wheel over the last 20 seconds leaves a dark streak.
  const fi = Math.floor(f);
  ctx.lineWidth = 0.3;
  for (let i = Math.max(1, fi - 20 * v.agentHz); i <= fi; i++) {
    for (const [axle, k] of [
      ["front", tr.frontSlide?.[i] ?? 0],
      ["rear", tr.rearSlide?.[i] ?? 0],
    ] as const) {
      if (k <= 0) continue;
      ctx.strokeStyle = `rgba(10,10,12,${(0.25 + 0.5 * k).toFixed(2)})`;
      for (const [wx, wy] of WHEELS[axle]) {
        const at = (j: number) => [
          tr.x[j]! + Math.cos(tr.yaw[j]!) * wx - Math.sin(tr.yaw[j]!) * wy,
          tr.y[j]! + Math.sin(tr.yaw[j]!) * wx + Math.cos(tr.yaw[j]!) * wy,
        ];
        const [x0, y0] = at(i - 1);
        const [x1, y1] = at(i);
        ctx.beginPath();
        ctx.moveTo(x0!, y0!);
        ctx.lineTo(x1!, y1!);
        ctx.stroke();
      }
    }
  }

  for (const c of [...v.cars].sort((a, b) => Number(b.ghost ?? false) - Number(a.ghost ?? false))) {
    const cf = Math.min(v.frame, c.trace.x.length - 1);
    ctx.save();
    ctx.translate(sample(c.trace.x, cf), sample(c.trace.y, cf));
    ctx.rotate(sampleAngle(c.trace.yaw, cf));
    drawCar(ctx, c.colors, v.car.length, v.car.width, c.ghost, tyreState(c.trace, Math.floor(cf)));
    ctx.restore();
  }

  ctx.setTransform(d, 0, 0, d, 0, 0);
  const m = v.zoom > 12 ? 10 : 20;
  ctx.fillStyle = PALETTE.fg;
  ctx.fillRect(16, H / d - 20, m * v.zoom, 2);
  ctx.font = "12px Chivo, system-ui, sans-serif";
  ctx.fillText(`${m} m`, 16, H / d - 26);
}

export function drawMap(cv: HTMLCanvasElement, geo: TrackGeometry, cars: Car[], frame: number): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const d = fitCanvas(cv);
  const W = cv.width;
  const H = cv.height;
  const b = geo.bounds;
  const pad = 12 * d;
  const s = Math.min((W - 2 * pad) / (b.maxX - b.minX), (H - 2 * pad) / (b.maxY - b.minY));
  const ox = (W - (b.maxX - b.minX) * s) / 2 - b.minX * s;
  const oy = (H + (b.maxY - b.minY) * s) / 2 + b.minY * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(s, 0, 0, -s, ox, oy);
  ctx.fillStyle = "#C9CED6";
  ctx.fill(geo.surface, "evenodd");
  ctx.lineWidth = (2.5 * d) / s;
  ctx.strokeStyle = PALETTE.start;
  ctx.stroke(geo.start);
  const lead = cars.find((c) => !c.ghost);
  if (lead) {
    ctx.beginPath();
    const f = Math.min(frame, lead.trace.x.length - 1);
    for (let i = 0; i <= Math.floor(f); i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, lead.trace.x[i]!, lead.trace.y[i]!);
    ctx.strokeStyle = PALETTE.trail;
    ctx.lineWidth = (2 * d) / s;
    ctx.stroke();
  }
  for (const c of cars) {
    const f = Math.min(frame, c.trace.x.length - 1);
    ctx.beginPath();
    ctx.arc(sample(c.trace.x, f), sample(c.trace.y, f), (5 * d) / s, 0, 2 * Math.PI);
    ctx.fillStyle = c.ghost ? "#FFFFFF" : c.colors.primary;
    ctx.fill();
    ctx.lineWidth = (1.5 * d) / s;
    ctx.strokeStyle = c.ghost ? PALETTE.fg : "#FFFFFF";
    ctx.stroke();
  }
}

/** Speed line plus throttle (green) and brake (red) bands, with a cursor. */
export function drawTelemetry(cv: HTMLCanvasElement, trace: LapTrace, frame: number): void {
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const d = fitCanvas(cv);
  const W = cv.width;
  const H = cv.height;
  const n = trace.speed.length;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  let vmax = 1;
  for (let i = 0; i < n; i++) vmax = Math.max(vmax, trace.speed[i]!);
  const step = Math.max(1, Math.floor(n / W));
  for (let i = 0; i < n; i += step) {
    const t = trace.throttle[i]!;
    const xp = (i / (n - 1)) * W;
    ctx.fillStyle = t >= 0 ? PALETTE.throttle : PALETTE.brake;
    ctx.globalAlpha = 0.22;
    const hgt = Math.min(1, Math.abs(t)) * H * 0.3;
    ctx.fillRect(xp, H - hgt, (W / n) * step + 1, hgt);
  }
  ctx.globalAlpha = 1;
  // Lock-ups (blue) and wheelspin (orange) as ticks along the top.
  for (let i = 0; i < n; i++) {
    const ts = tyreState(trace, i);
    if (!ts.front && !ts.rear) continue;
    ctx.fillStyle = ts.front > 0 ? LOCK_COLOR : ts.rearColor;
    ctx.fillRect((i / (n - 1)) * W, 18 * d, Math.max(1, W / n), 6 * d);
  }
  ctx.beginPath();
  for (let i = 0; i < n; i += step) {
    const xp = (i / (n - 1)) * W;
    const yp = H - 6 * d - (trace.speed[i]! / vmax) * (H - 22 * d);
    (i ? ctx.lineTo : ctx.moveTo).call(ctx, xp, yp);
  }
  ctx.strokeStyle = PALETTE.speed;
  ctx.lineWidth = 1.5 * d;
  ctx.stroke();
  ctx.fillStyle = PALETTE.muted;
  ctx.font = `${11 * d}px Chivo, system-ui, sans-serif`;
  ctx.fillText(`Speed, peak ${Math.round(vmax * 3.6)} km/h · throttle green · brake red · ticks: lock-up blue, wheelspin orange`, 8 * d, 14 * d);
  const xp = (Math.min(frame, n - 1) / (n - 1)) * W;
  ctx.fillStyle = PALETTE.fg;
  ctx.fillRect(xp - d, 0, 2 * d, H);
}
