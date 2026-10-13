// Car parameter slots. Index order MUST match CAR_PARAM_ORDER in
// packages/rules/src/car.ts; packages/sim-core/test checks this.

export const MASS: i32 = 0;
export const LENGTH: i32 = 1;
export const WIDTH: i32 = 2;
export const WHEELBASE: i32 = 3;
export const CG_TO_FRONT: i32 = 4;
export const YAW_INERTIA: i32 = 5;
export const MAX_STEER: i32 = 6;
export const STEER_RATE: i32 = 7;
export const POWER: i32 = 8;
export const MAX_BRAKE_FORCE: i32 = 9;
export const BRAKE_BIAS_FRONT: i32 = 10;
export const TYRE_MU: i32 = 11;
export const PACEJKA_B: i32 = 12;
export const PACEJKA_C: i32 = 13;
export const PACEJKA_E: i32 = 14;
export const DRAG_AREA: i32 = 15;
export const DOWNFORCE_AREA: i32 = 16;
export const AERO_BALANCE_FRONT: i32 = 17;
export const AIR_DENSITY: i32 = 18;
export const ROLLING_RESISTANCE: i32 = 19;
export const GRAVITY: i32 = 20;
export const KINEMATIC_BELOW: i32 = 21;
export const DYNAMIC_ABOVE: i32 = 22;

export const PARAM_COUNT: i32 = 23;

export const params = new StaticArray<f64>(PARAM_COUNT);

// @ts-ignore: decorator
@inline
export function p(i: i32): f64 {
  return unchecked(params[i]);
}
