/**
 * Track limits, by name. The index is the code the simulator takes
 * (sim-core's setTrackLimits), so never reorder this list.
 *
 * all-corners (solo-1, solo-2, the default when a rules version has no
 * `trackLimits`): all four corners of the car's body must stay inside the
 * track edges.
 *
 * one-tyre (solo-3, simulator 1.2.0+): as in F1, the car is legal while any
 * part of at least one tyre is on the track (the edge line counts as track).
 *
 * Either way the lap ends as crashed past the limit; there is no surface
 * model beyond the edges.
 */
export const TRACK_LIMITS = ["all-corners", "one-tyre"] as const;
export type TrackLimits = (typeof TRACK_LIMITS)[number];

/** The simulator's code for a rules version's track limits. */
export function trackLimitsCode(limits: TrackLimits = "all-corners"): number {
  const code = TRACK_LIMITS.indexOf(limits);
  if (code < 0) throw new Error(`unknown track limits "${limits}"`);
  return code;
}
