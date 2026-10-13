// Public wasm API of the simulator core.
//
// Phase 2 scope so far: vehicle dynamics and the fixed-step clock.
// Track edges, rays, gates and lap status are added next, behind this same API.

import { PARAM_COUNT, params } from "./params";
import * as car from "./vehicle";

/** 1.0.0 encoded as major * 10000 + minor * 100 + patch. */
export const SIM_VERSION: i32 = 10000;

export const STEP_OK: i32 = 0;
export const STEP_ERROR: i32 = 4;

let substeps: i32 = 4;
let dt: f64 = 1.0 / 240.0;
let steps: i32 = 0;

/** Packed car params, in CAR_PARAM_ORDER from @fevo/rules. */
export function setCarParams(values: Float64Array): void {
  assert(values.length == PARAM_COUNT, "wrong car param count");
  for (let i = 0; i < PARAM_COUNT; i++) unchecked((params[i] = values[i]));
}

export function setTiming(agentHz: i32, physicsSubsteps: i32): void {
  assert(agentHz > 0 && physicsSubsteps > 0, "bad timing");
  substeps = physicsSubsteps;
  dt = 1.0 / (<f64>agentHz * <f64>physicsSubsteps);
}

export function reset(x: f64, y: f64, yaw: f64, speed: f64): void {
  car.resetVehicle(x, y, yaw, speed);
  steps = 0;
}

/**
 * One agent step: steer and throttle in [-1, 1] (clamped, not rejected).
 * A NaN or infinite input ends the lap with STEP_ERROR.
 */
export function step(steer: f64, throttle: f64): i32 {
  if (!isFinite(steer) || !isFinite(throttle)) return STEP_ERROR;
  const s = steer < -1 ? -1.0 : steer > 1 ? 1.0 : steer;
  const t = throttle < -1 ? -1.0 : throttle > 1 ? 1.0 : throttle;
  for (let i = 0; i < substeps; i++) car.substep(s, t, dt);
  steps++;
  return STEP_OK;
}

export function getSteps(): i32 {
  return steps;
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
  return h;
}

function mix(h: u64, v: u64): u64 {
  for (let i = 0; i < 8; i++) {
    h ^= (v >> (<u64>i * 8)) & 0xff;
    h *= 0x100000001b3;
  }
  return h;
}
