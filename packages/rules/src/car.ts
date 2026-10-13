/**
 * Vehicle parameters for one rules version.
 * SI units throughout: m, kg, s, rad, N, W, kg/m³.
 */
export interface CarParams {
  /** Car plus driver, no fuel model in solo-1. */
  massKg: number;
  lengthM: number;
  widthM: number;
  wheelbaseM: number;
  /** Centre of gravity to front axle. Rear distance is wheelbase minus this. */
  cgToFrontM: number;
  yawInertiaKgM2: number;
  /** Road-wheel steering angle at full lock. */
  maxSteerRad: number;
  /** How fast the road wheels can move towards the commanded angle. */
  steerRateRadPerS: number;
  /** Peak power at the rear axle. Drive force is min(traction, power / speed). */
  powerW: number;
  /** Brake force at full pedal before tyre limits. */
  maxBrakeForceN: number;
  /** Fraction of brake force on the front axle. */
  brakeBiasFront: number;
  /** Peak tyre friction coefficient, same for both axles. */
  tyreMu: number;
  /** Simplified Pacejka lateral curve: D·sin(C·atan(B·α − E·(B·α − atan(B·α)))). */
  pacejkaB: number;
  pacejkaC: number;
  pacejkaE: number;
  /** Drag area Cd·A. */
  dragAreaM2: number;
  /** Downforce area Cl·A. */
  downforceAreaM2: number;
  /** Fraction of downforce on the front axle. */
  aeroBalanceFront: number;
  airDensityKgM3: number;
  rollingResistance: number;
  gravityMps2: number;
  /** Below this forward speed the model is purely kinematic. */
  kinematicBelowMps: number;
  /** Above this forward speed the model is purely dynamic. Linear blend in between. */
  dynamicAboveMps: number;
}

/**
 * Order in which CarParams are packed for the WASM sim.
 * MUST match the index constants in packages/sim-core/assembly/params.ts.
 */
export const CAR_PARAM_ORDER = [
  "massKg",
  "lengthM",
  "widthM",
  "wheelbaseM",
  "cgToFrontM",
  "yawInertiaKgM2",
  "maxSteerRad",
  "steerRateRadPerS",
  "powerW",
  "maxBrakeForceN",
  "brakeBiasFront",
  "tyreMu",
  "pacejkaB",
  "pacejkaC",
  "pacejkaE",
  "dragAreaM2",
  "downforceAreaM2",
  "aeroBalanceFront",
  "airDensityKgM3",
  "rollingResistance",
  "gravityMps2",
  "kinematicBelowMps",
  "dynamicAboveMps",
] as const satisfies readonly (keyof CarParams)[];

export function packCarParams(car: CarParams): Float64Array {
  const out = new Float64Array(CAR_PARAM_ORDER.length);
  CAR_PARAM_ORDER.forEach((key, i) => {
    const v = car[key];
    if (!Number.isFinite(v)) throw new Error(`car.${key} is not finite: ${v}`);
    out[i] = v;
  });
  return out;
}
