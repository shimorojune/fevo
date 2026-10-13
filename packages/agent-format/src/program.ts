/**
 * A compiled, format-independent network: every agent file becomes this
 * before it reaches the simulator.
 *
 * Values live in numbered slots. Nodes are evaluated in order; each computes
 *   value[slot] = activation(bias + response · aggregation(value[link.slot] · link.weight ...))
 * with links in the order they appeared in the file. Slots never written
 * stay 0.
 */
export interface ProgramNode {
  slot: number;
  activation: number;
  aggregation: number;
  bias: number;
  response: number;
  links: { slot: number; weight: number }[];
}

export interface Program {
  kind: "neat-genome" | "mlp";
  slotCount: number;
  /** Slot that receives observation i. */
  inputSlots: number[];
  /** Slots read as [steer, throttle]. */
  outputSlots: number[];
  nodes: ProgramNode[];
  /** Car setup, complete and in the rules' knob order (present when parsed against a rules version). */
  setup?: number[];
}

export interface PackedProgram {
  slotCount: number;
  /** Input slots followed by output slots. */
  io: Int32Array;
  /** Per node: slot, activation, aggregation, first link, link count. */
  nodeInts: Int32Array;
  /** Per node: bias, response. */
  nodeFloats: Float64Array;
  linkSlots: Int32Array;
  linkWeights: Float64Array;
}

export function packProgram(p: Program): PackedProgram {
  const nodeInts = new Int32Array(p.nodes.length * 5);
  const nodeFloats = new Float64Array(p.nodes.length * 2);
  const linkCount = p.nodes.reduce((a, n) => a + n.links.length, 0);
  const linkSlots = new Int32Array(linkCount);
  const linkWeights = new Float64Array(linkCount);
  let l = 0;
  p.nodes.forEach((n, i) => {
    nodeInts.set([n.slot, n.activation, n.aggregation, l, n.links.length], i * 5);
    nodeFloats.set([n.bias, n.response], i * 2);
    for (const link of n.links) {
      linkSlots[l] = link.slot;
      linkWeights[l] = link.weight;
      l++;
    }
  });
  return {
    slotCount: p.slotCount,
    io: Int32Array.from([...p.inputSlots, ...p.outputSlots]),
    nodeInts,
    nodeFloats,
    linkSlots,
    linkWeights,
  };
}

/** Parameter count as shown in the UI: every weight plus every bias. */
export function parameterCount(p: Program): number {
  return p.nodes.reduce((a, n) => a + n.links.length + 1, 0);
}

/** Canonical text of a program, for fingerprints. Two files that compile to the same network share it. */
export function canonicalProgram(p: Program): string {
  const base = [p.kind, p.slotCount, p.inputSlots, p.outputSlots, p.nodes];
  return JSON.stringify(p.setup ? [...base, p.setup] : base);
}

/** SHA-256 of the canonical program, hex. The UI shows the first 6 characters. */
export async function fingerprint(p: Program): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalProgram(p));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
