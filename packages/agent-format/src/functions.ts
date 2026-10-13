/**
 * Activation and aggregation functions an agent may use, and their numeric
 * codes in the wasm. Codes MUST match packages/sim-core/assembly/agent.ts.
 *
 * NEAT genomes use neat-python 2.0 semantics (its "tanh" is tanh(2.5·z),
 * clamped), so genomes trained with neat-python behave the same here.
 * MLPs use the textbook definitions (PyTorch semantics).
 */

export const GENOME_ACTIVATIONS = {
  sigmoid: 0,
  tanh: 1,
  sin: 2,
  gauss: 3,
  relu: 4,
  elu: 5,
  lelu: 6,
  selu: 7,
  softplus: 8,
  identity: 9,
  clamped: 10,
  inv: 11,
  log: 12,
  exp: 13,
  abs: 14,
  hat: 15,
  square: 16,
  cube: 17,
} as const;

export const MLP_ACTIVATIONS = {
  tanh: 20,
  sigmoid: 21,
  relu: 22,
  identity: 23,
} as const;

export const AGGREGATIONS = {
  sum: 0,
  product: 1,
  max: 2,
  min: 3,
  maxabs: 4,
  median: 5,
  mean: 6,
} as const;

export type GenomeActivation = keyof typeof GENOME_ACTIVATIONS;
export type MlpActivation = keyof typeof MLP_ACTIVATIONS;
export type Aggregation = keyof typeof AGGREGATIONS;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Reference implementations in host JS, by code. Used by tests to check the
 * wasm; never used to score a lap (host Math differs between engines).
 */
export const REFERENCE_ACTIVATION: Record<number, (z: number) => number> = {
  0: (z) => 1 / (1 + Math.exp(-clamp(5 * z, -60, 60))),
  1: (z) => Math.tanh(clamp(2.5 * z, -60, 60)),
  2: (z) => Math.sin(clamp(5 * z, -60, 60)),
  3: (z) => Math.exp(-5 * clamp(z, -3.4, 3.4) ** 2),
  4: (z) => (z > 0 ? z : 0),
  5: (z) => (z > 0 ? z : Math.exp(z) - 1),
  6: (z) => (z > 0 ? z : 0.005 * z),
  7: (z) => (z > 0 ? 1.0507009873554805 * z : 1.0507009873554805 * 1.6732632423543772 * (Math.exp(z) - 1)),
  8: (z) => 0.2 * Math.log(1 + Math.exp(clamp(5 * z, -60, 60))),
  9: (z) => z,
  10: (z) => clamp(z, -1, 1),
  11: (z) => (z === 0 ? 0 : 1 / z),
  12: (z) => Math.log(Math.max(1e-7, z)),
  13: (z) => Math.exp(clamp(z, -60, 60)),
  14: (z) => Math.abs(z),
  15: (z) => Math.max(0, 1 - Math.abs(z)),
  16: (z) => z * z,
  17: (z) => z * z * z,
  20: (z) => Math.tanh(z),
  21: (z) => 1 / (1 + Math.exp(-z)),
  22: (z) => (z > 0 ? z : 0),
  23: (z) => z,
};

export const REFERENCE_AGGREGATION: Record<number, (x: number[]) => number> = {
  0: (x) => x.reduce((a, b) => a + b, 0),
  1: (x) => x.reduce((a, b) => a * b, 1),
  2: (x) => (x.length ? x.reduce((a, b) => (b > a ? b : a)) : 0),
  3: (x) => (x.length ? x.reduce((a, b) => (b < a ? b : a)) : 0),
  4: (x) => (x.length ? x.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : 0),
  5: (x) => {
    if (!x.length) return 0;
    const s = [...x].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  },
  6: (x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0),
};
