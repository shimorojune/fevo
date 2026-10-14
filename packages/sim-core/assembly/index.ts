// Public wasm API of the simulator core.
//
// Sign convention at this boundary follows the rules: steer -1 is full left,
// +1 full right. Internally the vehicle model uses counter-clockwise positive.

import { CG_TO_FRONT, LENGTH, PARAM_COUNT, WHEELBASE, WIDTH, p, params } from "./params";
import * as agent from "./agent";
import * as track from "./track";
import * as car from "./vehicle";

/**
 * 1.3.0 encoded as major * 10000 + minor * 100 + patch. 1.1.0 added the
 * combined-slip rear tyre model for solo-2, 1.2.0 the one-tyre track limit
 * for solo-3, 1.3.0 the extended observation set (opt-in). Laps under
 * earlier rules versions are unchanged.
 */
export const SIM_VERSION: i32 = 10300;

/** Track limits: the whole car inside the edges (solo-1, solo-2). */
export const LIMITS_ALL_CORNERS: i32 = 0;
/** Track limits: any part of at least one tyre on the track (solo-3, as in F1). */
export const LIMITS_ONE_TYRE: i32 = 1;
let trackLimits: i32 = LIMITS_ALL_CORNERS;

export const STATUS_RUNNING: i32 = 0;
export const STATUS_FINISHED: i32 = 1;
export const STATUS_CRASHED: i32 = 2;
export const STATUS_STOPPED: i32 = 3;
export const STATUS_ERROR: i32 = 4;
export const STATUS_TIMED_OUT: i32 = 5;

/** Max points the car can move along the centreline per substep (1 m spacing, 0.4 m per substep at 345 km/h). */
const PROGRESS_WINDOW: i32 = 8;
/** Search window for each car corner around the car's own point. */
const CORNER_WINDOW: i32 = 12;
/** A gate counts only if the car is within this many points past it. */
const GATE_WINDOW: i32 = 50;
const MAX_RAYS: i32 = 64;

let substeps: i32 = 4;
let dt: f64 = 1.0 / 240.0;
let maxSteps: i32 = 12000;
let stopSpeed: f64 = 1.0;
let stopSteps: i32 = 120;
let rayCount: i32 = 11;
let rayLength: f64 = 200.0;
let rayFov: f64 = Math.PI;
let speedNorm: f64 = 100.0;

/**
 * Practice only: above this forward speed throttle is cut. Official laps run
 * with no limit; configure() in @fevo/sim and the Python SDK reset it.
 */
let speedLimit: f64 = Infinity;

/** Strongest lock-up / wheelspin in the last agent step, per axle (0–1). */
let stepFrontSlide: f64 = 0;
let stepRearSlide: f64 = 0;

let steps: i32 = 0;
let status: i32 = STATUS_RUNNING;
let slowSteps: i32 = 0;
let progressIdx: i32 = 0;
/** Next gate to cross; gateCount means every gate is done and the start line finishes the lap. */
let nextGate: i32 = 1;

/**
 * Observation sets. OBS_STANDARD is what every rules version so far defines:
 * rays, speed, gate progress, offset and heading (rayCount + 4 numbers).
 * OBS_EXTENDED appends EXTRA_OBS numbers about the car itself and the road
 * ahead (see observe()). The standard set's numbers are the same either way.
 */
export const OBS_STANDARD: i32 = 0;
export const OBS_EXTENDED: i32 = 1;
export const EXTRA_OBS: i32 = 18;
let obsSet: i32 = OBS_STANDARD;
const obs = new StaticArray<f64>(MAX_RAYS + 4 + EXTRA_OBS);

// ---- configuration ----

/** Packed car params, in CAR_PARAM_ORDER from @fevo/rules. */
export function setCarParams(values: Float64Array): void {
  assert(values.length == PARAM_COUNT, "wrong car param count");
  for (let i = 0; i < PARAM_COUNT; i++) unchecked((params[i] = values[i]));
}

/** Rear tyre model under power (see setRearSlideModel in vehicle.ts): 0 drive-only (solo-1), 1 combined slip. */
export function setRearSlideModel(model: i32, mu: f64): void {
  assert(model == car.REAR_SLIDE_DRIVE_ONLY || model == car.REAR_SLIDE_COMBINED, "unknown rear slide model");
  assert(mu > 0 && mu <= 1, "rear sliding friction must be in (0, 1] of peak grip");
  car.setRearSlideModel(model, mu);
}

/**
 * How a lap ends off the track (checked every physics substep; past the limit
 * the lap ends as crashed, whichever rule applies). There is no surface model
 * beyond the edges: a tyre over the line grips as it would on the track.
 *
 * LIMITS_ALL_CORNERS: all four corners of the car's body rectangle (length
 * by width) must be inside the edges.
 * LIMITS_ONE_TYRE: legal while any part of at least one tyre is on the track
 * (the edge line counts as track). Tyres sit at the axles (cgToFront ahead of
 * the centre, wheelbase - cgToFront behind) with their outer edges at the
 * car's full width; the part of the tyres nearest the track is always an
 * outer edge, so tyre width doesn't change the rule.
 */
export function setTrackLimits(mode: i32): void {
  assert(mode == LIMITS_ALL_CORNERS || mode == LIMITS_ONE_TYRE, "unknown track limits");
  trackLimits = mode;
}

export function setTiming(agentHz: i32, physicsSubsteps: i32): void {
  assert(agentHz > 0 && physicsSubsteps > 0, "bad timing");
  substeps = physicsSubsteps;
  dt = 1.0 / (<f64>agentHz * <f64>physicsSubsteps);
}

export function setLimits(maxLapSteps: i32, stopSpeedMps: f64, stopAfterSteps: i32): void {
  maxSteps = maxLapSteps;
  stopSpeed = stopSpeedMps;
  stopSteps = stopAfterSteps;
}

export function setObservationSet(set: i32): void {
  assert(set == OBS_STANDARD || set == OBS_EXTENDED, "unknown observation set");
  obsSet = set;
}

/** Numbers in the observation: rayCount + 4, plus EXTRA_OBS for the extended set. */
export function getObservationCount(): i32 {
  return rayCount + 4 + (obsSet == OBS_EXTENDED ? EXTRA_OBS : 0);
}

export function setSensors(count: i32, lengthM: f64, fovRad: f64, speedNormMps: f64): void {
  assert(count >= 2 && count <= MAX_RAYS, "bad ray count");
  rayCount = count;
  rayLength = lengthM;
  rayFov = fovRad;
  speedNorm = speedNormMps;
}

export { loadTrack } from "./track";
export { loadAgent } from "./agent";

/** Practice only. Pass Infinity (or any value ≤ 0) for no limit. */
export function setSpeedLimit(mps: f64): void {
  speedLimit = mps > 0 ? mps : Infinity;
}

// ---- raw-memory API, for hosts without the JS bindings (the Python SDK) ----
//
// The host writes plain numbers into these two buffers, then calls one of the
// *FromScratch functions with the counts. Layouts are documented on each.

const scratchF = new StaticArray<f64>(1 << 18);
const scratchI = new StaticArray<i32>(1 << 16);

export function scratchF64(): usize {
  return changetype<usize>(scratchF);
}
export function scratchI32(): usize {
  return changetype<usize>(scratchI);
}
export function scratchF64Capacity(): i32 {
  return scratchF.length;
}
export function scratchI32Capacity(): i32 {
  return scratchI.length;
}

/** F64: the car params in CAR_PARAM_ORDER. */
export function setCarParamsFromScratch(count: i32): void {
  assert(count == PARAM_COUNT, "wrong car param count");
  for (let i = 0; i < PARAM_COUNT; i++) unchecked((params[i] = scratchF[i]));
}

/** F64: centreline (2n), widthLeft (n), widthRight (n). I32: gates (gateCount). */
export function loadTrackFromScratch(n: i32, gateCount: i32): void {
  const centre = new Float64Array(2 * n);
  const wl = new Float64Array(n);
  const wr = new Float64Array(n);
  const gates = new Int32Array(gateCount);
  for (let i = 0; i < 2 * n; i++) centre[i] = scratchF[i];
  for (let i = 0; i < n; i++) {
    wl[i] = scratchF[2 * n + i];
    wr[i] = scratchF[3 * n + i];
  }
  for (let i = 0; i < gateCount; i++) gates[i] = scratchI[i];
  track.loadTrack(centre, wl, wr, gates);
}

/**
 * I32: io (ioLen), nodeInts (5 × nodeCount), linkSlots (linkCount).
 * F64: nodeFloats (2 × nodeCount), linkWeights (linkCount).
 */
export function loadAgentFromScratch(slotCount: i32, ioLen: i32, nodeCount: i32, linkCount: i32): void {
  const io = new Int32Array(ioLen);
  const ints = new Int32Array(5 * nodeCount);
  const lSlots = new Int32Array(linkCount);
  const floats = new Float64Array(2 * nodeCount);
  const weights = new Float64Array(linkCount);
  let k = 0;
  for (let i = 0; i < ioLen; i++) io[i] = scratchI[k++];
  for (let i = 0; i < 5 * nodeCount; i++) ints[i] = scratchI[k++];
  for (let i = 0; i < linkCount; i++) lSlots[i] = scratchI[k++];
  k = 0;
  for (let i = 0; i < 2 * nodeCount; i++) floats[i] = scratchF[k++];
  for (let i = 0; i < linkCount; i++) weights[i] = scratchF[k++];
  agent.loadAgent(slotCount, io, ints, floats, lSlots, weights);
}

// ---- running a lap ----

/** Free placement without a track, for vehicle tests. */
export function reset(x: f64, y: f64, yaw: f64, speed: f64): void {
  car.resetVehicle(x, y, yaw, speed);
  stepFrontSlide = 0;
  stepRearSlide = 0;
  steps = 0;
  status = STATUS_RUNNING;
  slowSteps = 0;
}

/** Place the car on the start line, nudged by a seed. Positive values move/turn it right. */
export function resetAtStart(lateralRightM: f64, headingRightRad: f64, speed: f64): void {
  assert(track.loaded, "no track loaded");
  const i = track.gateIndex(0);
  const x = track.centreX(i) - track.normalX(i) * lateralRightM;
  const y = track.centreY(i) - track.normalY(i) * lateralRightM;
  reset(x, y, track.headingAt(i) - headingRightRad, speed);
  progressIdx = i;
  nextGate = 1;
  observe();
}

/**
 * Practice only: place the car at any centreline point. Gates behind the
 * point count as already passed, so the lap finishes at the start line.
 */
export function resetAtPoint(index: i32, lateralRightM: f64, headingRightRad: f64, speed: f64): void {
  assert(track.loaded, "no track loaded");
  const i = ((index % track.n) + track.n) % track.n;
  const x = track.centreX(i) - track.normalX(i) * lateralRightM;
  const y = track.centreY(i) - track.normalY(i) * lateralRightM;
  reset(x, y, track.headingAt(i) - headingRightRad, speed);
  progressIdx = i;
  nextGate = 1;
  while (nextGate < track.gateCount && track.gateIndex(nextGate) <= i) nextGate++;
  observe();
}

/**
 * One agent step: steer and throttle in [-1, 1] (clamped, not rejected).
 * Returns the lap status; once it isn't RUNNING, further steps do nothing.
 */
export function step(steer: f64, throttle: f64): i32 {
  if (status != STATUS_RUNNING) return status;
  if (!isFinite(steer) || !isFinite(throttle)) {
    status = STATUS_ERROR;
    return status;
  }
  const s = steer < -1 ? -1.0 : steer > 1 ? 1.0 : steer;
  const t = throttle < -1 ? -1.0 : throttle > 1 ? 1.0 : throttle;
  stepFrontSlide = 0;
  stepRearSlide = 0;
  for (let k = 0; k < substeps; k++) {
    car.substep(-s, t > 0 && car.vx >= speedLimit ? 0.0 : t, dt);
    stepFrontSlide = Math.max(stepFrontSlide, car.frontSlide);
    stepRearSlide = Math.max(stepRearSlide, car.rearSlide);
    if (track.loaded) {
      updateProgress();
      if (status != STATUS_RUNNING) break;
      if (offTrack()) {
        status = STATUS_CRASHED;
        break;
      }
    }
  }
  steps++;
  if (status == STATUS_RUNNING) {
    slowSteps = car.vx < stopSpeed ? slowSteps + 1 : 0;
    if (slowSteps >= stopSteps) status = STATUS_STOPPED;
    else if (steps >= maxSteps) status = STATUS_TIMED_OUT;
  }
  if (track.loaded) observe();
  return status;
}

/** One step driven by the loaded agent, from the current observation. */
export function agentStep(): i32 {
  assert(agent.loaded && agent.inputCount == getObservationCount(), "agent inputs don't match the observation");
  agent.evaluate(obs);
  return step(agent.outSteer, agent.outThrottle);
}

/** Drive the loaded agent until the lap ends. Returns the final status. */
export function runAgentLap(): i32 {
  while (status == STATUS_RUNNING) agentStep();
  return status;
}

/** Last raw agent outputs (before clamping), for replays and telemetry. */
export function getAgentSteer(): f64 {
  return agent.outSteer;
}
export function getAgentThrottle(): f64 {
  return agent.outThrottle;
}

const probe = new StaticArray<f64>(MAX_RAYS + 4 + EXTRA_OBS);

/**
 * Fast path for step-by-step training hosts: one call per step. Steps, then
 * writes into the F64 scratch buffer: the observation (rayCount + 4 values),
 * then forward speed, lateral speed, yaw rate, progress index, gates passed,
 * steps, front slide and rear slide. Returns the status.
 */
export function stepToScratch(steer: f64, throttle: f64): i32 {
  const st = step(steer, throttle);
  const k = getObservationCount();
  for (let i = 0; i < k; i++) unchecked((scratchF[i] = obs[i]));
  unchecked((scratchF[k] = car.vx));
  unchecked((scratchF[k + 1] = car.vy));
  unchecked((scratchF[k + 2] = car.r));
  unchecked((scratchF[k + 3] = <f64>progressIdx));
  unchecked((scratchF[k + 4] = <f64>(nextGate - 1)));
  unchecked((scratchF[k + 5] = <f64>steps));
  unchecked((scratchF[k + 6] = stepFrontSlide));
  unchecked((scratchF[k + 7] = stepRearSlide));
  return st;
}

/** Raw-memory variant of evaluateAgent: inputs are the first `count` numbers of the F64 scratch buffer. */
export function evaluateAgentFromScratch(count: i32): void {
  for (let i = 0; i < count; i++) unchecked((probe[i] = scratchF[i]));
  agent.evaluate(probe);
}

/** Evaluate the loaded agent on arbitrary inputs, for parity tests. */
export function evaluateAgent(inputs: Float64Array): void {
  for (let i = 0; i < inputs.length; i++) unchecked((probe[i] = inputs[i]));
  agent.evaluate(probe);
}

function updateProgress(): void {
  const prev = progressIdx;
  const idx = track.nearestLocal(car.x, car.y, prev, PROGRESS_WINDOW);
  const n = track.n;
  const g = track.gateCount;
  while (nextGate < g) {
    const ahead = idx - track.gateIndex(nextGate);
    if (ahead < 0 || ahead > GATE_WINDOW) break;
    nextGate++;
  }
  // Start line is point 0: crossing it forwards means wrapping from the end of the loop to the start.
  if (nextGate == g && prev > n - GATE_WINDOW && idx < GATE_WINDOW) status = STATUS_FINISHED;
  progressIdx = idx;
}

function offTrack(): bool {
  if (trackLimits == LIMITS_ONE_TYRE) return allTyresOff();
  const hl = p(LENGTH) * 0.5;
  const hw = p(WIDTH) * 0.5;
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  for (let k = 0; k < 4; k++) {
    const fx = k < 2 ? hl : -hl;
    const fy = k % 2 == 0 ? hw : -hw;
    const px = car.x + fx * c - fy * s;
    const py = car.y + fx * s + fy * c;
    const i = track.nearestLocal(px, py, progressIdx, CORNER_WINDOW);
    if (track.outside(i, px, py)) return true;
  }
  return false;
}

/** One-tyre limit: off only when the outer edge of every tyre is past the edges. */
function allTyresOff(): bool {
  const front = p(CG_TO_FRONT);
  const rear = front - p(WHEELBASE);
  const hw = p(WIDTH) * 0.5;
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  for (let k = 0; k < 4; k++) {
    const fx = k < 2 ? front : rear;
    const fy = k % 2 == 0 ? hw : -hw;
    const px = car.x + fx * c - fy * s;
    const py = car.y + fx * s + fy * c;
    const i = track.nearestLocal(px, py, progressIdx, CORNER_WINDOW);
    if (!track.outside(i, px, py)) return false;
  }
  return true;
}

/** Fill the observation in the order the rules define: rays left to right, speed, progress, offset, heading. */
function observe(): void {
  const c = car.yaw;
  for (let k = 0; k < rayCount; k++) {
    const a = c + rayFov * 0.5 - (rayFov * <f64>k) / <f64>(rayCount - 1);
    const d = track.raycast(car.x, car.y, Math.cos(a), Math.sin(a), rayLength);
    unchecked((obs[k] = d / rayLength));
  }
  const i = progressIdx;
  const half = (track.widthLeftAt(i) + track.widthRightAt(i)) * 0.5;
  unchecked((obs[rayCount] = clamp(car.vx / speedNorm, 0, 1)));
  unchecked((obs[rayCount + 1] = <f64>(nextGate - 1) / <f64>track.gateCount));
  unchecked((obs[rayCount + 2] = clamp(-track.lateralAt(i, car.x, car.y) / half, -1, 1)));
  unchecked((obs[rayCount + 3] = car.wrapAngle(track.headingAt(i) - c) / Math.PI));
  if (obsSet == OBS_EXTENDED) observeExtended(rayCount + 4);
}

/** Curvature samples ahead (metres along the centre line) in the extended observation. */
const LOOK_AHEAD_M: StaticArray<i32> = [25, 50, 100, 150, 200, 300, 400];
/** A corner, for the next-corner inputs: centre-line radius under this many metres. */
const CORNER_RADIUS_M: f64 = 300;
/** How far ahead the next corner is looked for. */
const CORNER_SEARCH_M: i32 = 600;

/** Signed centre-line curvature at point i (1/m, left positive): heading change over ±10 m. */
function curvatureAt(i: i32): f64 {
  const n = track.n;
  return car.wrapAngle(track.headingAt((i + 10) % n) - track.headingAt((i - 10 + n) % n)) / 20.0;
}

/**
 * The extended observation, after the standard numbers, each scaled to about
 * ±1 and, like heading and offset, positive to the right:
 *   0 yaw rate / 2 rad/s          1 body slip angle / 45°     2 sideways velocity / 10 m/s
 *   3 rear slide (wheelspin or lock-up, 0..1)                 4 front lock-up (0..1)
 *   5 longitudinal acceleration / 50 m/s² (forward positive)
 *   6 left margin, 7 right margin: metres from the tyre nearest each edge to it
 *     (the tyre points of the one-tyre limit), / 10; negative once over the line
 *   8..14 centre-line curvature 25, 50, 100, 150, 200, 300, 400 m ahead, × 50 m (a 50 m radius reads 1)
 *   15 distance to the next corner (radius under 300 m) / 600 m; 1 when none within 600 m
 *   16 that corner's sharpness: the strongest curvature in its first 150 m, × 50 m
 *   17 lap progress along the centre line (0..1, every metre, not every gate)
 * The look-ahead reaches braking zones: at 340 km/h braking starts ~250 m before a corner.
 */
function observeExtended(b: i32): void {
  unchecked((obs[b] = clamp(-car.r / 2.0, -1, 1)));
  unchecked((obs[b + 1] = clamp(-Math.atan2(car.vy, Math.max(car.vx, 1.0)) / (Math.PI / 4), -1, 1)));
  unchecked((obs[b + 2] = clamp(-car.vy / 10.0, -1, 1)));
  unchecked((obs[b + 3] = stepRearSlide));
  unchecked((obs[b + 4] = stepFrontSlide));
  unchecked((obs[b + 5] = clamp(car.longAccel() / 50.0, -1, 1)));
  const front = p(CG_TO_FRONT);
  const rear = front - p(WHEELBASE);
  const hw = p(WIDTH) * 0.5;
  const c = Math.cos(car.yaw);
  const s = Math.sin(car.yaw);
  let left = Infinity;
  let right = Infinity;
  for (let k = 0; k < 4; k++) {
    const fx = k < 2 ? front : rear;
    const fy = k % 2 == 0 ? hw : -hw;
    const px = car.x + fx * c - fy * s;
    const py = car.y + fx * s + fy * c;
    const i = track.nearestLocal(px, py, progressIdx, CORNER_WINDOW);
    const off = track.lateralAt(i, px, py);
    left = Math.min(left, track.widthLeftAt(i) - off);
    right = Math.min(right, track.widthRightAt(i) + off);
  }
  unchecked((obs[b + 6] = clamp(left / 10.0, -1, 1)));
  unchecked((obs[b + 7] = clamp(right / 10.0, -1, 1)));
  const n = track.n;
  for (let k = 0; k < LOOK_AHEAD_M.length; k++) {
    unchecked((obs[b + 8 + k] = clamp(-curvatureAt((progressIdx + unchecked(LOOK_AHEAD_M[k])) % n) * 50.0, -1, 1)));
  }
  let dist = CORNER_SEARCH_M;
  for (let d = 0; d <= CORNER_SEARCH_M; d += 5) {
    if (Math.abs(curvatureAt((progressIdx + d) % n)) * CORNER_RADIUS_M > 1.0) {
      dist = d;
      break;
    }
  }
  let sharp: f64 = 0;
  if (dist < CORNER_SEARCH_M) {
    for (let d = dist; d <= dist + 150; d += 5) {
      const k = curvatureAt((progressIdx + d) % n);
      if (Math.abs(k) > Math.abs(sharp)) sharp = k;
    }
  }
  unchecked((obs[b + 15] = <f64>dist / <f64>CORNER_SEARCH_M));
  unchecked((obs[b + 16] = clamp(-sharp * 50.0, -1, 1)));
  unchecked((obs[b + 17] = <f64>progressIdx / <f64>n));
}

// ---- reading state ----

export function getObservation(i: i32): f64 {
  assert(i >= 0 && i < getObservationCount(), "observation index out of range");
  return unchecked(obs[i]);
}
export function getStatus(): i32 {
  return status;
}
export function getSteps(): i32 {
  return steps;
}
export function getGatesPassed(): i32 {
  return nextGate - 1;
}
export function getProgressIndex(): i32 {
  return progressIdx;
}
export function getX(): f64 {
  return car.x;
}
export function getY(): f64 {
  return car.y;
}
export function getYaw(): f64 {
  return car.yaw;
}
export function getVx(): f64 {
  return car.vx;
}
export function getVy(): f64 {
  return car.vy;
}
export function getYawRate(): f64 {
  return car.r;
}
/** Front-axle lock-up in the last step, 0 (gripping) to 1. */
export function getFrontSlide(): f64 {
  return stepFrontSlide;
}
/** Rear-axle lock-up (braking) or wheelspin (throttle) in the last step, 0 to 1. */
export function getRearSlide(): f64 {
  return stepRearSlide;
}
export function getSteerAngle(): f64 {
  return car.delta;
}

/** FNV-1a over the exact bits of the full state, for cross-runtime golden tests. */
export function stateHash(): u64 {
  let h: u64 = 0xcbf29ce484222325;
  h = mix(h, reinterpret<u64>(car.x));
  h = mix(h, reinterpret<u64>(car.y));
  h = mix(h, reinterpret<u64>(car.yaw));
  h = mix(h, reinterpret<u64>(car.vx));
  h = mix(h, reinterpret<u64>(car.vy));
  h = mix(h, reinterpret<u64>(car.r));
  h = mix(h, reinterpret<u64>(car.delta));
  h = mix(h, <u64>steps);
  h = mix(h, <u64>status);
  h = mix(h, <u64>progressIdx);
  h = mix(h, <u64>nextGate);
  // Only models with a carried slide state hash it, so drive-only (solo-1) hashes are unchanged.
  if (car.rearSliding) h = mix(h, 1);
  return h;
}

function mix(h: u64, v: u64): u64 {
  for (let i = 0; i < 8; i++) {
    h ^= (v >> (<u64>i * 8)) & 0xff;
    h *= 0x100000001b3;
  }
  return h;
}

// @ts-ignore: decorator
@inline
function clamp(v: f64, lo: f64, hi: f64): f64 {
  return v < lo ? lo : v > hi ? hi : v;
}
