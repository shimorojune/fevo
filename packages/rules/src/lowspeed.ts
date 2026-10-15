/**
 * Low-speed models, by name. The index is the code the simulator takes
 * (sim-core's setLowSpeedModel), so never reorder this list.
 *
 * forward-speed (solo-1 to solo-4, the default when a rules version has no
 * `lowSpeed`): below walking pace the car blends to a kinematic model by its
 * forward speed, overwriting the sideways velocity. A spinning car (little
 * forward speed, fast sideways) lost its sideways speed at once: free braking.
 *
 * total-speed (solo-5, simulator 1.4.0+): the blend follows the total speed,
 * and never changes the sideways velocity faster than the tyres could, so a
 * sliding or spinning car slows no faster than grip plus drag allow.
 */
export const LOW_SPEED_MODELS = ["forward-speed", "total-speed"] as const;
export type LowSpeedModel = (typeof LOW_SPEED_MODELS)[number];

/** The simulator's code for a rules version's low-speed model. */
export function lowSpeedCode(model: LowSpeedModel = "forward-speed"): number {
  const code = LOW_SPEED_MODELS.indexOf(model);
  if (code < 0) throw new Error(`unknown low-speed model "${model}"`);
  return code;
}
