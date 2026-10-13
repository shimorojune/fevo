import type { CarParams } from "./car.ts";

/**
 * Car setup: a few knobs an agent file may set, each moving car parameters
 * along a real trade-off. Every knob is linear:
 *
 *   param = base + perUnit × (value − default)
 *
 * evaluated in exactly that order, so TypeScript and Python (which reads the
 * same numbers from the rules JSON) produce bit-identical cars. The rules'
 * base car is the car at the default setup.
 */
export interface SetupEffect {
  param: keyof CarParams;
  perUnit: number;
}

export interface SetupKnob {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  /** What it does, for the rules page. */
  help: string;
  effects: readonly SetupEffect[];
}

export type Setup = Record<string, number>;

export function setupDefaults(knobs: readonly SetupKnob[]): Setup {
  return Object.fromEntries(knobs.map((k) => [k.id, k.default]));
}

/** Errors in a setup block, worded for agent authors; empty if it's valid. */
export function validateSetup(knobs: readonly SetupKnob[], setup: unknown): string[] {
  if (typeof setup !== "object" || setup === null || Array.isArray(setup)) return ['"setup" must be an object.'];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(setup)) {
    const k = knobs.find((x) => x.id === key);
    if (!k) {
      errors.push(`Unknown setup "${key}". Known: ${knobs.map((x) => x.id).join(", ")}.`);
    } else if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`setup.${key} must be a number.`);
    } else if (value < k.min || value > k.max) {
      errors.push(`setup.${key} is ${value}; it must be between ${k.min} and ${k.max}.`);
    }
  }
  return errors;
}

/** The full setup in knob order, defaults filled in. */
export function completeSetup(knobs: readonly SetupKnob[], setup: Setup | undefined): number[] {
  return knobs.map((k) => (setup && k.id in setup ? setup[k.id]! : k.default));
}

/** The car for a setup. */
export function applySetup(base: CarParams, knobs: readonly SetupKnob[], setup: Setup | undefined): CarParams {
  const car: CarParams = { ...base };
  const values = completeSetup(knobs, setup);
  knobs.forEach((k, i) => {
    for (const e of k.effects) car[e.param] = car[e.param] + e.perUnit * (values[i]! - k.default);
  });
  return car;
}
