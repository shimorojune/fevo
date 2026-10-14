export { CAR_PARAM_ORDER, packCarParams, type CarParams } from "./car.ts";
export { SOLO_1, SOLO_1_CAR, SOLO_1_SETUP } from "./solo1.ts";
export { SOLO_2 } from "./solo2.ts";
export { SOLO_3 } from "./solo3.ts";
export { TRACK_LIMITS, trackLimitsCode, type TrackLimits } from "./limits.ts";
export { applySetup, completeSetup, setupDefaults, validateSetup, type Setup, type SetupKnob, type SetupEffect } from "./setup.ts";
export { DEFAULT_TYRES, REAR_SLIDE_MODELS, rearSlideArgs, type RearSlideModel, type TyreRules } from "./tyres.ts";

import { SOLO_1 } from "./solo1.ts";
import type { TrackLimits } from "./limits.ts";
import { SOLO_2 } from "./solo2.ts";
import { SOLO_3 } from "./solo3.ts";
import type { TyreRules } from "./tyres.ts";

/** Any rules version. solo-1 has no `tyres` block (drive-only rears); only solo-3 sets `trackLimits`. */
export type Rules = Omit<typeof SOLO_1, "id" | "simVersion"> & {
  id: string;
  simVersion: string;
  tyres?: TyreRules;
  trackLimits?: TrackLimits;
};

/** Every published rules version, oldest first. */
export const ALL_RULES: readonly Rules[] = [SOLO_1, SOLO_2, SOLO_3];

export function rulesById(id: string): Rules {
  const r = ALL_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`unknown rules "${id}" (have ${ALL_RULES.map((r) => r.id).join(", ")})`);
  return r;
}

/** The website still ranks on solo-1. */
export const CURRENT_RULES = SOLO_1;
