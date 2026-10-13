// Track geometry inside the wasm: centreline, edges, gates, and a uniform
// grid over the edge segments for raycasts.
//
// Edges are centreline ± left normal × width, with the normal taken from the
// neighbouring points (central difference). tools/track-builder/src/preview.ts
// draws edges the same way.

/** Grid cell size in metres. */
const CELL: f64 = 16.0;

export let n: i32 = 0;
export let loaded: bool = false;

let cx = new Float64Array(0);
let cy = new Float64Array(0);
let wl = new Float64Array(0);
let wr = new Float64Array(0);
/** Unit left normal per point. */
let nx = new Float64Array(0);
let ny = new Float64Array(0);
/** Track direction per point, radians counter-clockwise from +x. */
let heading = new Float64Array(0);
let lx = new Float64Array(0);
let ly = new Float64Array(0);
let rx = new Float64Array(0);
let ry = new Float64Array(0);

let gates = new Int32Array(0);
export let gateCount: i32 = 0;

let gridMinX: f64 = 0;
let gridMinY: f64 = 0;
let gridCols: i32 = 0;
let gridRows: i32 = 0;
let cellStart = new Int32Array(0);
let cellItems = new Int32Array(0);

export function loadTrack(centre: Float64Array, widthLeft: Float64Array, widthRight: Float64Array, gateIdx: Int32Array): void {
  const count = widthLeft.length;
  assert(count >= 3 && centre.length == count * 2 && widthRight.length == count, "bad track arrays");
  assert(gateIdx.length >= 1 && gateIdx[0] == 0, "gate 0 must be the start line at point 0");
  n = count;
  cx = new Float64Array(n);
  cy = new Float64Array(n);
  wl = new Float64Array(n);
  wr = new Float64Array(n);
  nx = new Float64Array(n);
  ny = new Float64Array(n);
  heading = new Float64Array(n);
  lx = new Float64Array(n);
  ly = new Float64Array(n);
  rx = new Float64Array(n);
  ry = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    cx[i] = centre[2 * i];
    cy[i] = centre[2 * i + 1];
    wl[i] = widthLeft[i];
    wr[i] = widthRight[i];
  }
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n;
    const q = (i + 1) % n;
    const tx = cx[q] - cx[p];
    const ty = cy[q] - cy[p];
    const len = Math.sqrt(tx * tx + ty * ty);
    nx[i] = -ty / len;
    ny[i] = tx / len;
    heading[i] = Math.atan2(ty, tx);
    lx[i] = cx[i] + nx[i] * wl[i];
    ly[i] = cy[i] + ny[i] * wl[i];
    rx[i] = cx[i] - nx[i] * wr[i];
    ry[i] = cy[i] - ny[i] * wr[i];
  }
  gateCount = gateIdx.length;
  gates = new Int32Array(gateCount);
  for (let i = 0; i < gateCount; i++) gates[i] = gateIdx[i];
  buildGrid();
  loaded = true;
}

export function gateIndex(g: i32): i32 {
  return gates[g];
}
export function centreX(i: i32): f64 {
  return cx[i];
}
export function centreY(i: i32): f64 {
  return cy[i];
}
export function headingAt(i: i32): f64 {
  return heading[i];
}
export function normalX(i: i32): f64 {
  return nx[i];
}
export function normalY(i: i32): f64 {
  return ny[i];
}
export function widthLeftAt(i: i32): f64 {
  return wl[i];
}
export function widthRightAt(i: i32): f64 {
  return wr[i];
}

/** Signed distance from the centreline at point i, positive to the left. */
export function lateralAt(i: i32, px: f64, py: f64): f64 {
  return (px - cx[i]) * nx[i] + (py - cy[i]) * ny[i];
}

/** True when (px, py) is outside the track edges, measured at point i. */
export function outside(i: i32, px: f64, py: f64): bool {
  const off = lateralAt(i, px, py);
  return off > wl[i] || -off > wr[i];
}

/** Nearest centreline point within ±window of hint, wrapping round the loop. */
export function nearestLocal(px: f64, py: f64, hint: i32, window: i32): i32 {
  let best = hint;
  let bestD = Infinity;
  for (let k = -window; k <= window; k++) {
    const i = (((hint + k) % n) + n) % n;
    const dx = px - cx[i];
    const dy = py - cy[i];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Distance along the ray (unit direction) to the first edge, capped at maxLen. */
export function raycast(ox: f64, oy: f64, dx: f64, dy: f64, maxLen: f64): f64 {
  let col = <i32>Math.floor((ox - gridMinX) / CELL);
  let row = <i32>Math.floor((oy - gridMinY) / CELL);
  if (col < 0 || row < 0 || col >= gridCols || row >= gridRows) return maxLen;

  const stepX: i32 = dx > 0 ? 1 : -1;
  const stepY: i32 = dy > 0 ? 1 : -1;
  let tMaxX: f64 = dx != 0 ? (gridMinX + <f64>(col + (dx > 0 ? 1 : 0)) * CELL - ox) / dx : Infinity;
  let tMaxY: f64 = dy != 0 ? (gridMinY + <f64>(row + (dy > 0 ? 1 : 0)) * CELL - oy) / dy : Infinity;
  const tDeltaX: f64 = dx != 0 ? CELL / Math.abs(dx) : Infinity;
  const tDeltaY: f64 = dy != 0 ? CELL / Math.abs(dy) : Infinity;

  let best = maxLen;
  while (true) {
    const cell = row * gridCols + col;
    for (let k = cellStart[cell]; k < cellStart[cell + 1]; k++) {
      const t = raySegment(ox, oy, dx, dy, cellItems[k]);
      if (t >= 0 && t < best) best = t;
    }
    const tExit = Math.min(tMaxX, tMaxY);
    if (best <= tExit || tExit >= maxLen) break;
    if (tMaxX < tMaxY) {
      col += stepX;
      tMaxX += tDeltaX;
    } else {
      row += stepY;
      tMaxY += tDeltaY;
    }
    if (col < 0 || row < 0 || col >= gridCols || row >= gridRows) break;
  }
  return best;
}

/** Segment s: s < n is left edge i -> i+1, otherwise right edge (s - n) -> next. */
function raySegment(ox: f64, oy: f64, dx: f64, dy: f64, s: i32): f64 {
  let ax: f64, ay: f64, bx: f64, by: f64;
  if (s < n) {
    const j = (s + 1) % n;
    ax = lx[s];
    ay = ly[s];
    bx = lx[j];
    by = ly[j];
  } else {
    const i = s - n;
    const j = (i + 1) % n;
    ax = rx[i];
    ay = ry[i];
    bx = rx[j];
    by = ry[j];
  }
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (denom == 0) return -1;
  const wx = ax - ox;
  const wy = ay - oy;
  const t = (wx * ey - wy * ex) / denom;
  const u = (wx * dy - wy * dx) / denom;
  return t >= 0 && u >= 0 && u <= 1 ? t : -1;
}

function buildGrid(): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, Math.min(lx[i], rx[i]));
    minY = Math.min(minY, Math.min(ly[i], ry[i]));
    maxX = Math.max(maxX, Math.max(lx[i], rx[i]));
    maxY = Math.max(maxY, Math.max(ly[i], ry[i]));
  }
  gridMinX = minX - CELL;
  gridMinY = minY - CELL;
  gridCols = <i32>Math.floor((maxX + CELL - gridMinX) / CELL) + 1;
  gridRows = <i32>Math.floor((maxY + CELL - gridMinY) / CELL) + 1;
  const cells = gridCols * gridRows;
  cellStart = new Int32Array(cells + 1);

  // Two passes: count segments per cell, then fill. Bounding-box insertion.
  for (let pass = 0; pass < 2; pass++) {
    const cursor = new Int32Array(cells);
    if (pass == 1) {
      for (let c = 0; c < cells; c++) cellStart[c + 1] += cellStart[c];
      cellItems = new Int32Array(cellStart[cells]);
    }
    for (let s = 0; s < 2 * n; s++) {
      const i = s < n ? s : s - n;
      const j = (i + 1) % n;
      const ax = s < n ? lx[i] : rx[i];
      const ay = s < n ? ly[i] : ry[i];
      const bx = s < n ? lx[j] : rx[j];
      const by = s < n ? ly[j] : ry[j];
      const c0 = <i32>Math.floor((Math.min(ax, bx) - gridMinX) / CELL);
      const c1 = <i32>Math.floor((Math.max(ax, bx) - gridMinX) / CELL);
      const r0 = <i32>Math.floor((Math.min(ay, by) - gridMinY) / CELL);
      const r1 = <i32>Math.floor((Math.max(ay, by) - gridMinY) / CELL);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const cell = r * gridCols + c;
          if (pass == 0) cellStart[cell + 1]++;
          else cellItems[cellStart[cell] + cursor[cell]++] = s;
        }
      }
    }
  }
}
