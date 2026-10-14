import type { CarParams } from "./car.ts";
import type { SetupKnob } from "./setup.ts";

/**
 * Rules version solo-1: one car, time attack, no tyre wear, fuel or slipstream.
 * Times only compare within a rules version. Never edit a published version;
 * add a new one instead.
 *
 * Car numbers are for a 2026-spec car (1.9 m wide, 3.4 m wheelbase). Grip,
 * downforce, drag and brakes come from tools/calibrate: the best fit to 2025
 * pole times that keeps the car physically plausible (358 km/h top speed,
 * about 2.5 g at 90 km/h, 4 g at 200 km/h, 6.4 g at 300 km/h). Its reference
 * laps are 5–10% slower than pole; the rest is track data, kerbs and the
 * strict all-four-corners track limit.
 */
export const SOLO_1_CAR = {
  massKg: 800,
  lengthM: 5.3,
  widthM: 1.9,
  wheelbaseM: 3.4,
  cgToFrontM: 1.87,
  cgHeightM: 0.28,
  yawInertiaKgM2: 1100,
  maxSteerRad: 0.38,
  steerRateRadPerS: 2.5,
  powerW: 750_000,
  maxBrakeForceN: 60_000,
  brakeBiasFront: 0.58,
  tyreMuFront: 2.0,
  tyreMuRear: 2.15,
  pacejkaBFront: 13,
  pacejkaBRear: 15,
  pacejkaC: 1.5,
  pacejkaE: -0.5,
  dragAreaM2: 1.25,
  downforceAreaM2: 4.0,
  aeroBalanceFront: 0.45,
  airDensityKgM3: 1.2,
  rollingResistance: 0.015,
  gravityMps2: 9.80665,
  kinematicBelowMps: 3,
  dynamicAboveMps: 6,
} as const satisfies CarParams;

/**
 * Setup knobs for solo-1, modelled on what F1 teams actually trade off.
 * The base car above is the default setup. Effects are per unit of the knob.
 */
export const SOLO_1_SETUP = [
  {
    id: "wing",
    label: "Wing level",
    min: 0,
    max: 1,
    default: 0.3,
    help: "Front and rear wing angle together. 0 is a Monza low-drag trim, 1 a Monaco-style maximum-downforce trim: more grip in corners, more drag on the straights.",
    effects: [
      { param: "downforceAreaM2", perUnit: 2.0 },
      { param: "dragAreaM2", perUnit: 0.35 },
    ],
  },
  {
    id: "aeroBalance",
    label: "Aero balance",
    min: 0.4,
    max: 0.5,
    default: 0.45,
    help: "Share of downforce on the front axle. More front sharpens turn-in at speed but makes the rear lighter in fast corners.",
    effects: [{ param: "aeroBalanceFront", perUnit: 1 }],
  },
  {
    id: "antiRollBalance",
    label: "Anti-roll bar balance",
    min: -1,
    max: 1,
    default: 0,
    help: "Front bar stiffer (+) or rear bar stiffer (−). A stiffer front bar makes the front respond faster but take more of the load transfer, so it grips less at the limit (understeer); a stiffer rear does the opposite (oversteer). Matters most in slow corners.",
    effects: [
      { param: "pacejkaBFront", perUnit: 1.0 },
      { param: "pacejkaBRear", perUnit: -1.0 },
      { param: "tyreMuFront", perUnit: -0.15 },
      { param: "tyreMuRear", perUnit: 0.15 },
    ],
  },
  {
    id: "brakeBias",
    label: "Brake bias",
    min: 0.52,
    max: 0.64,
    default: 0.58,
    help: "Share of brake force on the front axle. Forward is stable but locks the fronts sooner; rearward uses more of the rears and stops shorter, until the rear locks and the car turns round.",
    effects: [{ param: "brakeBiasFront", perUnit: 1 }],
  },
] as const satisfies readonly SetupKnob[];

export const SOLO_1 = {
  id: "solo-1",
  simVersion: "1.0.0",
  car: SOLO_1_CAR,
  setup: SOLO_1_SETUP,
  timing: {
    /** Agent decisions per second. Lap time = steps / agentHz. */
    agentHz: 60,
    /** Physics substeps per agent step (240 Hz physics). */
    physicsSubsteps: 4,
    /** A lap still running after this many steps ends as timed out. */
    maxSteps: 12_000,
    /** Below this speed for stopSteps in a row, the lap ends as stopped. */
    stopSpeedMps: 1,
    stopSteps: 120,
  },
  start: {
    /** Standing start on the start line, car centred on the centreline. */
    kind: "standing",
    initialSpeedMps: 0,
  },
  /**
   * Fixed starting nudges, one per official lap. No RNG: a seed is an index
   * into this table, so every lap is reproducible everywhere.
   * Positive lateralM moves the car right; positive headingRad turns it right.
   */
  seeds: [
    { lateralM: -0.5, headingRad: -0.005 },
    { lateralM: 0, headingRad: 0 },
    { lateralM: 0.5, headingRad: 0.005 },
  ],
  track: {
    /** Approximate spacing of gates along the centreline. */
    gateSpacingM: 40,
  },
  sensors: {
    rayCount: 11,
    rayLengthM: 200,
    /** Rays spread evenly from -90° (left) to +90° (right) of the car's heading. */
    rayFovRad: Math.PI,
    /** Observation speed = forward speed / this, clamped to [0, 1]. */
    speedNormMps: 100,
  },
  observation: [
    "ray_0",
    "ray_1",
    "ray_2",
    "ray_3",
    "ray_4",
    "ray_5",
    "ray_6",
    "ray_7",
    "ray_8",
    "ray_9",
    "ray_10",
    "speed",
    "lap_progress",
    "lateral_offset",
    "heading_error",
  ],
  action: ["steer", "throttle"],
  agent: {
    maxFileBytes: 500 * 1024,
  },
} as const;

export type Rules = typeof SOLO_1;
