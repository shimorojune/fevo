import type { CarParams } from "./car.ts";

/**
 * Rules version solo-1: one car, time attack, no tyre wear, fuel or slipstream.
 * Times only compare within a rules version. Never edit a published version;
 * add a new one instead.
 *
 * Car numbers are first-pass estimates for a 2026-spec car (1.9 m wide,
 * 3.4 m wheelbase). They are calibrated in phase 4 against real lap times
 * and frozen before solo-1 opens.
 */
export const SOLO_1_CAR = {
  massKg: 800,
  lengthM: 5.3,
  widthM: 1.9,
  wheelbaseM: 3.4,
  cgToFrontM: 1.87,
  yawInertiaKgM2: 1100,
  maxSteerRad: 0.3,
  steerRateRadPerS: 2.5,
  powerW: 750_000,
  maxBrakeForceN: 40_000,
  brakeBiasFront: 0.58,
  tyreMuFront: 1.65,
  tyreMuRear: 1.8,
  pacejkaBFront: 13,
  pacejkaBRear: 15,
  pacejkaC: 1.5,
  pacejkaE: -0.5,
  dragAreaM2: 1.4,
  downforceAreaM2: 4.8,
  aeroBalanceFront: 0.45,
  airDensityKgM3: 1.2,
  rollingResistance: 0.015,
  gravityMps2: 9.80665,
  kinematicBelowMps: 3,
  dynamicAboveMps: 6,
} as const satisfies CarParams;

export const SOLO_1 = {
  id: "solo-1",
  simVersion: "1.0.0",
  car: SOLO_1_CAR,
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
