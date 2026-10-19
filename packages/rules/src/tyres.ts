/**
 * How the rear tyres behave under power, by name. The index is the code the
 * simulator takes (sim-core's setRearSlideModel), so never reorder this list.
 *
 * drive-only (solo-1, the default when a rules version has no `tyres`): the
 * rears spin only while the drive force alone is more than their grip.
 *
 * combined-slip (solo-2, simulator 1.1.0+): with the throttle open, the rears
 * break away once drive plus cornering together ask for more than their peak
 * grip. A spinning tyre slides at `rearSlideMu` × peak grip, with its force
 * against the contact patch's sliding velocity: the harder the wheels spin
 * relative to the sideways slide, the less cornering force is left. They grip
 * again once the demand falls below that sliding grip, or the throttle closes.
 */
export const REAR_SLIDE_MODELS = ["drive-only", "combined-slip"] as const;
export type RearSlideModel = (typeof REAR_SLIDE_MODELS)[number];

export interface TyreRules {
  rearSlide: RearSlideModel;
  /** Sliding friction of a spinning rear tyre as a share of its peak grip, in (0, 1]. */
  rearSlideMu: number;
}

/** Rules versions without a `tyres` block (solo-1) drive the original model. */
export const DEFAULT_TYRES: TyreRules = { rearSlide: "drive-only", rearSlideMu: 1 };

/** The simulator's (model, mu) arguments for a rules version's tyres. */
export function rearSlideArgs(tyres: TyreRules = DEFAULT_TYRES): [model: number, mu: number] {
  const model = REAR_SLIDE_MODELS.indexOf(tyres.rearSlide);
  if (model < 0) throw new Error(`unknown rear slide model "${tyres.rearSlide}"`);
  if (!(tyres.rearSlideMu > 0 && tyres.rearSlideMu <= 1)) throw new Error("rearSlideMu must be in (0, 1]");
  return [model, tyres.rearSlideMu];
}
