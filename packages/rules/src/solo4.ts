import type { Rules } from "./index.ts";
import { EXTENDED_OBSERVATION } from "./observation.ts";
import { SOLO_3 } from "./solo3.ts";

/**
 * Rules version solo-4: solo-3 (combined-slip rears, one-tyre track limit)
 * with the extended observation: after the 15 standard inputs, 18 more about
 * the car and the road ahead, reaching 400 m so braking zones can be seen
 * coming (see observation.ts). Agents take 33 inputs.
 * Same car, physics, timing, seeds and sensors as solo-3. Needs simulator 1.3.0.
 *
 * Never edit a published version; add a new one instead.
 */
export const SOLO_4 = {
  ...SOLO_3,
  id: "solo-4",
  simVersion: "1.3.0",
  observation: [...SOLO_3.observation, ...EXTENDED_OBSERVATION],
} as const satisfies Rules;
