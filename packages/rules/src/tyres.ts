/**
 * How the rear tyres behave under power, by name. The index is the code the
 * simulator takes (sim-core's setRearSlideModel), so never reorder this list.
 *
 * drive-only (solo-1, the default when a rules version has no `tyres`): the
 * rears spin only while the drive force alone is more than their grip.
 *
 * combined-sticky (solo-2, simulator 1.1.0+): with the throttle open, the
 * rears break away once drive plus cornering together ask for more than their
 * grip, and keep sliding until that demand falls below `rearSlideExit` ×
 * sliding grip or the throttle is closed.
 */
export const REAR_SLIDE_MODELS = ["drive-only", "combined-sticky"] as const;
export type RearSlideModel = (typeof REAR_SLIDE_MODELS)[number];

export interface TyreRules {
  rearSlide: RearSlideModel;
  /** Share of sliding grip the combined demand must fall below to end a slide, in (0, 1]. */
  rearSlideExit: number;
}

/** Rules versions without a `tyres` block (solo-1) drive the original model. */
export const DEFAULT_TYRES: TyreRules = { rearSlide: "drive-only", rearSlideExit: 1 };

/** The simulator's (model, exit) arguments for a rules version's tyres. */
export function rearSlideArgs(tyres: TyreRules = DEFAULT_TYRES): [model: number, exit: number] {
  const model = REAR_SLIDE_MODELS.indexOf(tyres.rearSlide);
  if (model < 0) throw new Error(`unknown rear slide model "${tyres.rearSlide}"`);
  if (!(tyres.rearSlideExit > 0 && tyres.rearSlideExit <= 1)) throw new Error("rearSlideExit must be in (0, 1]");
  return [model, tyres.rearSlideExit];
}
