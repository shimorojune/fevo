/**
 * Observation sets, by the names in a rules version's `observation` list.
 * Code 0 (standard): rays, speed, progress, offset, heading, what solo-1/2/3
 * define. Code 1 (extended, simulator 1.3.0+): the standard numbers followed
 * by EXTENDED_OBSERVATION, in this order (sim-core's observeExtended()).
 */
export const EXTENDED_OBSERVATION = [
  "yaw_rate",
  "body_slip",
  "lateral_velocity",
  "rear_slide",
  "front_slide",
  "long_accel",
  "left_margin",
  "right_margin",
  "curvature_25",
  "curvature_50",
  "curvature_100",
  "curvature_150",
  "curvature_200",
  "curvature_300",
  "curvature_400",
  "next_corner_distance",
  "next_corner_sharpness",
  "progress_m",
] as const;

/** The simulator's observation-set code for an observation list (rays first, as every rules version has). */
export function observationSetCode(observation: readonly string[], rayCount: number): number {
  const standard = rayCount + 4;
  if (observation.length === standard) return 0;
  const extra = observation.slice(standard);
  if (extra.length === EXTENDED_OBSERVATION.length && extra.every((n, i) => n === EXTENDED_OBSERVATION[i])) return 1;
  throw new Error(`unknown observation set: ${observation.join(", ")}`);
}
