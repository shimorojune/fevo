import type { Rules } from "./index.ts";
import { SOLO_2 } from "./solo2.ts";

/**
 * Rules version solo-3: solo-2 with F1's track limit. The car is legal while
 * any part of at least one tyre is on the track (the edge line counts), not
 * only while the whole car is inside the edges. Same car, physics, timing,
 * seeds, sensors and agent format as solo-2. Needs simulator 1.2.0.
 *
 * Never edit a published version; add a new one instead.
 */
export const SOLO_3 = {
  ...SOLO_2,
  id: "solo-3",
  simVersion: "1.2.0",
  trackLimits: "one-tyre",
} as const satisfies Rules;
