// Neural network evaluation inside the wasm, so an agent's outputs are
// bit-identical in every engine (host Math.tanh/exp differ between browsers).
//
// The program format comes from @fevo/agent-format (packProgram). Function
// codes MUST match packages/agent-format/src/functions.ts.

// Genome activations: neat-python 2.0 semantics.
const SIGMOID: i32 = 0;
const TANH: i32 = 1;
const SIN: i32 = 2;
const GAUSS: i32 = 3;
const RELU: i32 = 4;
const ELU: i32 = 5;
const LELU: i32 = 6;
const SELU: i32 = 7;
const SOFTPLUS: i32 = 8;
const IDENTITY: i32 = 9;
const CLAMPED: i32 = 10;
const INV: i32 = 11;
const LOG: i32 = 12;
const EXP: i32 = 13;
const ABS: i32 = 14;
const HAT: i32 = 15;
const SQUARE: i32 = 16;
const CUBE: i32 = 17;
// MLP activations: textbook semantics.
const STD_TANH: i32 = 20;
const STD_SIGMOID: i32 = 21;
const STD_RELU: i32 = 22;
const STD_IDENTITY: i32 = 23;

const AGG_SUM: i32 = 0;
const AGG_PRODUCT: i32 = 1;
const AGG_MAX: i32 = 2;
const AGG_MIN: i32 = 3;
const AGG_MAXABS: i32 = 4;
const AGG_MEDIAN: i32 = 5;
const AGG_MEAN: i32 = 6;

export let loaded: bool = false;
export let inputCount: i32 = 0;

let values = new Float64Array(0);
let io = new Int32Array(0);
let nodeInts = new Int32Array(0);
let nodeFloats = new Float64Array(0);
let linkSlots = new Int32Array(0);
let linkWeights = new Float64Array(0);
let nodeCount: i32 = 0;
/** Scratch for median. */
let scratch = new Float64Array(0);

export let outSteer: f64 = 0;
export let outThrottle: f64 = 0;

export function loadAgent(
  slotCount: i32,
  ioSlots: Int32Array,
  ints: Int32Array,
  floats: Float64Array,
  lSlots: Int32Array,
  lWeights: Float64Array,
): void {
  assert(ioSlots.length >= 3, "agent needs inputs and two outputs");
  assert(ints.length % 5 == 0 && floats.length * 5 == ints.length * 2, "bad node arrays");
  assert(lSlots.length == lWeights.length, "bad link arrays");
  values = new Float64Array(slotCount);
  io = ioSlots.slice();
  inputCount = io.length - 2;
  nodeInts = ints.slice();
  nodeFloats = floats.slice();
  linkSlots = lSlots.slice();
  linkWeights = lWeights.slice();
  nodeCount = ints.length / 5;
  let maxLinks = 0;
  for (let i = 0; i < nodeCount; i++) maxLinks = max(maxLinks, nodeInts[i * 5 + 4]);
  scratch = new Float64Array(maxLinks);
  for (let i = 0; i < io.length; i++) assert(io[i] >= 0 && io[i] < slotCount, "io slot out of range");
  for (let i = 0; i < lSlots.length; i++) assert(lSlots[i] >= 0 && lSlots[i] < slotCount, "link slot out of range");
  loaded = true;
}

/** Run the network on inputs; results land in outSteer / outThrottle. */
export function evaluate(inputs: StaticArray<f64>): void {
  values.fill(0);
  for (let i = 0; i < inputCount; i++) values[io[i]] = unchecked(inputs[i]);
  for (let n = 0; n < nodeCount; n++) {
    const b = n * 5;
    const slot = nodeInts[b];
    const act = nodeInts[b + 1];
    const agg = nodeInts[b + 2];
    const first = nodeInts[b + 3];
    const count = nodeInts[b + 4];
    const s = aggregate(agg, first, count);
    values[slot] = activate(act, nodeFloats[n * 2] + nodeFloats[n * 2 + 1] * s);
  }
  outSteer = values[io[inputCount]];
  outThrottle = values[io[inputCount + 1]];
}

function aggregate(agg: i32, first: i32, count: i32): f64 {
  if (agg == AGG_SUM || agg == AGG_MEAN) {
    let s: f64 = 0;
    for (let k = 0; k < count; k++) s += values[linkSlots[first + k]] * linkWeights[first + k];
    return agg == AGG_SUM ? s : count > 0 ? s / <f64>count : 0;
  }
  if (agg == AGG_PRODUCT) {
    let s: f64 = 1;
    for (let k = 0; k < count; k++) s *= values[linkSlots[first + k]] * linkWeights[first + k];
    return s;
  }
  if (count == 0) return 0;
  let best = values[linkSlots[first]] * linkWeights[first];
  if (agg == AGG_MEDIAN) {
    // Insertion sort into scratch: deterministic and fine for small fan-in.
    for (let k = 0; k < count; k++) {
      const v = values[linkSlots[first + k]] * linkWeights[first + k];
      let j = k;
      while (j > 0 && scratch[j - 1] > v) {
        scratch[j] = scratch[j - 1];
        j--;
      }
      scratch[j] = v;
    }
    const m = count >> 1;
    return count % 2 == 1 ? scratch[m] : (scratch[m - 1] + scratch[m]) / 2;
  }
  // First of equals wins, as in Python's max/min.
  for (let k = 1; k < count; k++) {
    const v = values[linkSlots[first + k]] * linkWeights[first + k];
    if (agg == AGG_MAX && v > best) best = v;
    else if (agg == AGG_MIN && v < best) best = v;
    else if (agg == AGG_MAXABS && Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

function activate(act: i32, z: f64): f64 {
  switch (act) {
    case SIGMOID:
      return 1.0 / (1.0 + Math.exp(-clamp(5.0 * z, -60.0, 60.0)));
    case TANH:
      return Math.tanh(clamp(2.5 * z, -60.0, 60.0));
    case SIN:
      return Math.sin(clamp(5.0 * z, -60.0, 60.0));
    case GAUSS: {
      const c = clamp(z, -3.4, 3.4);
      return Math.exp(-5.0 * c * c);
    }
    case RELU:
      return z > 0 ? z : 0.0;
    case ELU:
      return z > 0 ? z : Math.exp(z) - 1.0;
    case LELU:
      return z > 0 ? z : 0.005 * z;
    case SELU:
      return z > 0 ? 1.0507009873554805 * z : 1.0507009873554805 * 1.6732632423543772 * (Math.exp(z) - 1.0);
    case SOFTPLUS:
      return 0.2 * Math.log(1.0 + Math.exp(clamp(5.0 * z, -60.0, 60.0)));
    case IDENTITY:
      return z;
    case CLAMPED:
      return clamp(z, -1.0, 1.0);
    case INV:
      return z == 0 ? 0.0 : 1.0 / z;
    case LOG:
      return Math.log(Math.max(1e-7, z));
    case EXP:
      return Math.exp(clamp(z, -60.0, 60.0));
    case ABS:
      return Math.abs(z);
    case HAT:
      return Math.max(0.0, 1.0 - Math.abs(z));
    case SQUARE:
      return z * z;
    case CUBE:
      return z * z * z;
    case STD_TANH:
      return Math.tanh(z);
    case STD_SIGMOID:
      return 1.0 / (1.0 + Math.exp(-z));
    case STD_RELU:
      return z > 0 ? z : 0.0;
    case STD_IDENTITY:
      return z;
  }
  return NaN;
}

// @ts-ignore: decorator
@inline
function clamp(v: f64, lo: f64, hi: f64): f64 {
  return v < lo ? lo : v > hi ? hi : v;
}
