import type { Rules } from "./index.ts";
import { SOLO_4 } from "./solo4.ts";

/**
 * Rules version solo-5: solo-4 (combined-slip rears, one-tyre track limit,
 * 33 inputs) with the total-speed low-speed model: a spinning or sliding car
 * can no longer lose its sideways speed faster than its tyres allow (see
 * lowspeed.ts). Same car, timing, seeds, sensors and inputs as solo-4, so a
 * solo-4 agent runs unchanged. Needs simulator 1.4.0.
 *
 * Never edit a published version; add a new one instead.
 */
export const SOLO_5 = {
  ...SOLO_4,
  id: "solo-5",
  simVersion: "1.4.0",
  lowSpeed: "total-speed",
} as const satisfies Rules;
