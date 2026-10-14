import { SOLO_1 } from "./solo1.ts";
import type { Rules } from "./index.ts";

/**
 * Rules version solo-2: solo-1 with power oversteer. Same car, setup knobs,
 * timing, seeds, sensors and agent format; only the rear tyres under power
 * change (see tyres.ts). Needs simulator 1.1.0.
 *
 * Built from solo-1 because published versions never change, so solo-2 can't
 * drift with it. Never edit a published version; add a new one instead.
 */
export const SOLO_2 = {
  ...SOLO_1,
  id: "solo-2",
  simVersion: "1.1.0",
  tyres: {
    rearSlide: "combined-sticky",
    rearSlideExit: 0.88,
  },
} as const satisfies Rules;
