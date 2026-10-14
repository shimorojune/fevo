// Dynamic single-track (bicycle) model with simplified Pacejka lateral tyres,
// a friction circle per axle, aero downforce and drag, and power-limited
// rear drive. Blends to a kinematic model at walking pace, where slip angles
// are undefined.
//
// Frames: world x/y in metres with y up, yaw counter-clockwise from +x.
// Body frame: vx forward, vy to the left, r = yaw rate (counter-clockwise).
// Every Math call here is AssemblyScript's own implementation compiled into
// the wasm, so results are bit-identical in every engine.

import {
  AERO_BALANCE_FRONT,
  AIR_DENSITY,
  BRAKE_BIAS_FRONT,
  CG_HEIGHT,
  CG_TO_FRONT,
  DOWNFORCE_AREA,
  DRAG_AREA,
  DYNAMIC_ABOVE,
  GRAVITY,
  KINEMATIC_BELOW,
  MASS,
  MAX_BRAKE_FORCE,
  MAX_STEER,
  PACEJKA_B_FRONT,
  PACEJKA_B_REAR,
  PACEJKA_C,
  PACEJKA_E,
  POWER,
  ROLLING_RESISTANCE,
  STEER_RATE,
  TYRE_MU_FRONT,
  TYRE_MU_REAR,
  WHEELBASE,
  YAW_INERTIA,
  p,
} from "./params";

/** Slip angles are computed with at least this forward speed. */
const MIN_SLIP_SPEED: f64 = 0.5;
/** Drive force uses at least this speed in P / v, so launch is traction-limited. */
const MIN_DRIVE_SPEED: f64 = 1.0;
/** A sliding (locked or spinning) tyre's friction, as a share of its peak grip. */
const SLIDE_MU: f64 = 0.85;
/** Share of a sliding tyre's force that can still act sideways. */
const SLIDE_LATERAL: f64 = 0.25;
/** Reported slide intensity starts here, so even a light lock-up shows. */
const SLIDE_MIN: f64 = 0.2;

/** Lock-up or wheelspin intensity on each axle in the last substep, 0 (gripping) to 1. */
export let frontSlide: f64 = 0;
/** Longitudinal acceleration from the last substep, for load transfer. */
let axPrev: f64 = 0;
export let rearSlide: f64 = 0;

export let x: f64 = 0;
export let y: f64 = 0;
export let yaw: f64 = 0;
export let vx: f64 = 0;
export let vy: f64 = 0;
export let r: f64 = 0;
/** Road-wheel steering angle. */
export let delta: f64 = 0;

export function resetVehicle(px: f64, py: f64, pyaw: f64, pvx: f64): void {
  x = px;
  y = py;
  yaw = wrapAngle(pyaw);
  vx = pvx;
  vy = 0;
  frontSlide = 0;
  rearSlide = 0;
  axPrev = 0;
  r = 0;
  delta = 0;
}

/**
 * Advance one physics substep.
 * steerCmd and throttleCmd are already clamped to [-1, 1] and finite.
 */
export function substep(steerCmd: f64, throttleCmd: f64, dt: f64): void {
  // Steering actuator: move towards the commanded angle at a limited rate.
  const target = steerCmd * p(MAX_STEER);
  const maxMove = p(STEER_RATE) * dt;
  delta += clamp(target - delta, -maxMove, maxMove);

  const m = p(MASS);
  const L = p(WHEELBASE);
  const a = p(CG_TO_FRONT);
  const b = L - a;
  const g = p(GRAVITY);

  // Aero.
  const q = 0.5 * p(AIR_DENSITY) * vx * vx;
  const downforce = q * p(DOWNFORCE_AREA);
  const drag = q * p(DRAG_AREA);
  const aeroFront = p(AERO_BALANCE_FRONT);

  // Normal loads: static split, downforce, and longitudinal load transfer
  // (braking moves load onto the fronts, accelerating onto the rears), from
  // the previous substep's acceleration.
  const transfer = (m * axPrev * p(CG_HEIGHT)) / L;
  const fzf = Math.max(0.0, (m * g * b) / L + downforce * aeroFront - transfer);
  const fzr = Math.max(0.0, (m * g * a) / L + downforce * (1.0 - aeroFront) + transfer);

  // Longitudinal demand.
  let fxf: f64 = 0;
  let fxr: f64 = 0;
  if (throttleCmd >= 0) {
    fxr = (throttleCmd * p(POWER)) / Math.max(vx, MIN_DRIVE_SPEED);
  } else if (vx > 0) {
    const brake = -throttleCmd * p(MAX_BRAKE_FORCE);
    const bias = p(BRAKE_BIAS_FRONT);
    fxf = -brake * bias;
    fxr = -brake * (1.0 - bias);
  }

  // Lateral tyre forces from slip angles.
  const vxs = Math.max(vx, MIN_SLIP_SPEED);
  const alphaF = delta - Math.atan2(vy + a * r, vxs);
  const alphaR = -Math.atan2(vy - b * r, vxs);
  const muF = p(TYRE_MU_FRONT);
  const muR = p(TYRE_MU_REAR);
  let fyf = pacejka(alphaF, muF * fzf, p(PACEJKA_B_FRONT));
  let fyr = pacejka(alphaR, muR * fzr, p(PACEJKA_B_REAR));

  // Tyre limits per axle. Asking for more braking or drive than the tyre can
  // give locks or spins the wheels: the tyre slides, at lower friction and
  // with almost no cornering force (locked fronts go straight on, spinning
  // rears step out). Within the limit, the friction circle shares grip
  // between braking/drive and cornering.
  const capF = muF * fzf;
  const capR = muR * fzr;
  frontSlide = 0;
  rearSlide = 0;
  if (Math.abs(fxf) > capF) {
    frontSlide = Math.min(1.0, Math.abs(fxf) / capF - 1.0 + SLIDE_MIN);
    fxf = Math.sign(fxf) * SLIDE_MU * capF;
    fyf = clamp(fyf, -SLIDE_LATERAL * SLIDE_MU * capF, SLIDE_LATERAL * SLIDE_MU * capF);
  } else {
    const demandF = Math.sqrt(fxf * fxf + fyf * fyf);
    if (demandF > capF) {
      const k = capF / demandF;
      fxf *= k;
      fyf *= k;
    }
  }
  if (Math.abs(fxr) > capR) {
    rearSlide = Math.min(1.0, Math.abs(fxr) / capR - 1.0 + SLIDE_MIN);
    fxr = Math.sign(fxr) * SLIDE_MU * capR;
    fyr = clamp(fyr, -SLIDE_LATERAL * SLIDE_MU * capR, SLIDE_LATERAL * SLIDE_MU * capR);
  } else {
    const demandR = Math.sqrt(fxr * fxr + fyr * fyr);
    if (demandR > capR) {
      const k = capR / demandR;
      fxr *= k;
      fyr *= k;
    }
  }

  const rolling = vx > 0 ? p(ROLLING_RESISTANCE) * m * g : 0.0;
  const cd = Math.cos(delta);
  const sd = Math.sin(delta);

  const ax = (fxr + fxf * cd - fyf * sd - drag - rolling) / m + vy * r;
  axPrev = (fxr + fxf * cd - fyf * sd - drag - rolling) / m;
  const ay = (fyr + fyf * cd + fxf * sd) / m - vx * r;
  const yawAcc = (a * (fyf * cd + fxf * sd) - b * fyr) / p(YAW_INERTIA);

  // Semi-implicit Euler: velocities first, then positions with the new velocities.
  let nvx = vx + ax * dt;
  if (nvx < 0) nvx = 0; // No reverse gear in solo-1.
  let nvy = vy + ay * dt;
  let nr = r + yawAcc * dt;

  // Below walking pace slip angles are meaningless: blend to the kinematic model.
  const lo = p(KINEMATIC_BELOW);
  const hi = p(DYNAMIC_ABOVE);
  const w = clamp((nvx - lo) / (hi - lo), 0, 1);
  if (w < 1) {
    const tanD = Math.tan(delta);
    const vyKin = (nvx * b * tanD) / L;
    const rKin = (nvx * tanD) / L;
    nvy = w * nvy + (1.0 - w) * vyKin;
    nr = w * nr + (1.0 - w) * rKin;
  }

  vx = nvx;
  vy = nvy;
  r = nr;

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  x += (vx * cy - vy * sy) * dt;
  y += (vx * sy + vy * cy) * dt;
  yaw = wrapAngle(yaw + r * dt);
}

/** Lateral force for slip angle alpha with peak force d. */
function pacejka(alpha: f64, d: f64, b: f64): f64 {
  const ba = b * alpha;
  return d * Math.sin(p(PACEJKA_C) * Math.atan(ba - p(PACEJKA_E) * (ba - Math.atan(ba))));
}

// @ts-ignore: decorator
@inline
function clamp(v: f64, lo: f64, hi: f64): f64 {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapAngle(a: f64): f64 {
  const twoPi = 2.0 * Math.PI;
  while (a > Math.PI) a -= twoPi;
  while (a < -Math.PI) a += twoPi;
  return a;
}
