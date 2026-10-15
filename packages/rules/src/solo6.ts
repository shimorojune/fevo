import type { Rules } from "./index.ts";
import { MEMORY_OBSERVATION } from "./observation.ts";
import { SOLO_5 } from "./solo5.ts";

/**
 * Rules version solo-6: solo-5 with a short memory. After solo-5's 33 inputs, six more: the steering and pedal the
 * car actually got last step, and the change over the last 0.1 s in forward speed, yaw rate, lateral offset and
 * heading to the track (see observation.ts). Agents take 39 inputs. Same car, physics, timing, seeds and sensors
 * as solo-5. Needs simulator 1.5.0.
 *
 * Never edit a published version; add a new one instead.
 */
export const SOLO_6 = {
  ...SOLO_5,
  id: "solo-6",
  simVersion: "1.5.0",
  observation: [...SOLO_5.observation, ...MEMORY_OBSERVATION],
} as const satisfies Rules;
