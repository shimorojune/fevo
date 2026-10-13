import { REFERENCE_ACTIVATION, REFERENCE_AGGREGATION } from "./functions.ts";
import type { Program } from "./program.ts";

/** Evaluate a program in host JS. For tests only: scoring runs inside the wasm. */
export function evaluateReference(p: Program, inputs: readonly number[]): number[] {
  const v = new Float64Array(p.slotCount);
  p.inputSlots.forEach((s, i) => (v[s] = inputs[i]!));
  for (const n of p.nodes) {
    const agg = REFERENCE_AGGREGATION[n.aggregation]!(n.links.map((l) => v[l.slot]! * l.weight));
    v[n.slot] = REFERENCE_ACTIVATION[n.activation]!(n.bias + n.response * agg);
  }
  return p.outputSlots.map((s) => v[s]!);
}
