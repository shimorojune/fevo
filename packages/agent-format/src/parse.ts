import { AGGREGATIONS, GENOME_ACTIVATIONS, MLP_ACTIVATIONS } from "./functions.ts";
import type { Program, ProgramNode } from "./program.ts";

export const MAX_FILE_BYTES = 500 * 1024;
export const MAX_NODES = 2000;
export const MAX_CONNECTIONS = 20000;

export type AgentErrorCode =
  | "too_large"
  | "invalid_json"
  | "unknown_format"
  | "bad_field"
  | "wrong_inputs"
  | "wrong_outputs"
  | "duplicate_id"
  | "bad_reference"
  | "unknown_activation"
  | "unknown_aggregation"
  | "loop"
  | "too_big"
  | "mlp_shape";

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  hint?: string;
}

export type ParseResult = { ok: true; program: Program } | { ok: false; errors: AgentError[] };

export interface Shape {
  inputs: number;
  outputs: number;
}

class Fail extends Error {
  readonly errors: AgentError[];
  constructor(errors: AgentError[]) {
    super(errors[0]?.message);
    this.errors = errors;
  }
}

const fail = (code: AgentErrorCode, message: string, hint?: string): never => {
  throw new Fail([hint === undefined ? { code, message } : { code, message, hint }]);
};

/** Validate an uploaded agent file and compile it. Never throws. */
export function parseAgent(text: string, shape: Shape): ParseResult {
  try {
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_FILE_BYTES) {
      fail("too_large", `The file is ${Math.ceil(bytes / 1024)} KB; the limit is ${MAX_FILE_BYTES / 1024} KB.`);
    }
    const data = parseJson(text);
    if (isObject(data) && Array.isArray(data.nodes) && Array.isArray(data.connections)) {
      return { ok: true, program: compileGenome(data, shape) };
    }
    if (isObject(data) && Array.isArray(data.layers)) {
      return { ok: true, program: compileMlp(data, shape) };
    }
    return fail(
      "unknown_format",
      "This doesn't look like a NEAT genome or an MLP.",
      'A genome has "nodes" and "connections"; an MLP has "layers", "weights" and "biases".',
    );
  } catch (e) {
    if (e instanceof Fail) return { ok: false, errors: e.errors };
    throw e;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Engines word JSON errors differently and don't all give a position, so find it ourselves.
    const { index, problem } = locateJsonError(text);
    const before = text.slice(0, index);
    const line = before.split("\n").length;
    const column = index - before.lastIndexOf("\n");
    const trailingComma = /,\s*$/.test(before) && /^[}\]]/.test(text.slice(index));
    // eslint-disable-next-line no-control-regex
    const binary = /[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 64));
    const hint = trailingComma
      ? "Usually a trailing comma before } or ]."
      : binary
        ? "This looks like a binary file. Pickle and .npz files need converting to JSON first."
        : undefined;
    return fail("invalid_json", `This file isn't valid JSON. Line ${line}, column ${column}: ${problem}.`, hint);
  }
}

/** Minimal strict JSON scanner that reports where parsing first fails. */
function locateJsonError(text: string): { index: number; problem: string } {
  let i = 0;
  const ws = () => {
    while (i < text.length && " \t\r\n".includes(text[i]!)) i++;
  };
  const bad = (problem: string): never => {
    throw { index: i, problem };
  };
  const show = () => (i < text.length ? `unexpected ${JSON.stringify(text[i])}` : "unexpected end of file");
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") return void i++;
      while (true) {
        ws();
        if (text[i] !== '"') bad(`${show()}, expected a "quoted" key`);
        string();
        ws();
        if (text[i] !== ":") bad(`${show()}, expected :`);
        i++;
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") return void i++;
        bad(`${show()}, expected , or }`);
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      while (true) {
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") return void i++;
        bad(`${show()}, expected , or ]`);
      }
    }
    if (c === '"') return string();
    const lit = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 400));
    if (lit) {
      i += lit[0].length;
      return;
    }
    bad(show());
  };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === "\\") i++;
      else if (text.charCodeAt(i) < 0x20) bad("control character inside a string");
      i++;
    }
    if (i >= text.length) bad("unterminated string");
    i++;
  };
  try {
    value();
    ws();
    if (i < text.length) bad(`${show()} after the end of the data`);
    return { index: i, problem: "unknown problem" };
  } catch (e) {
    return e as { index: number; problem: string };
  }
}

// ---------------------------------------------------------------- NEAT genome

interface GenomeNode {
  id: number;
  type: "input" | "hidden" | "output";
  bias: number;
  response: number;
  activation: number;
  aggregation: number;
}

function compileGenome(data: Record<string, unknown>, shape: Shape): Program {
  const rawNodes = data.nodes as unknown[];
  const rawConns = data.connections as unknown[];
  if (rawNodes.length > MAX_NODES) fail("too_big", `The genome has ${rawNodes.length} nodes; the limit is ${MAX_NODES}.`);
  if (rawConns.length > MAX_CONNECTIONS) {
    fail("too_big", `The genome has ${rawConns.length} connections; the limit is ${MAX_CONNECTIONS}.`);
  }

  const nodes = new Map<number, GenomeNode>();
  rawNodes.forEach((raw, i) => {
    const where = `nodes[${i}]`;
    if (!isObject(raw)) return fail("bad_field", `${where} must be an object.`);
    const id = int(raw.id, `${where}.id`);
    if (nodes.has(id)) fail("duplicate_id", `Node ${id} appears twice.`);
    const rawType = raw.type ?? "hidden";
    if (rawType !== "input" && rawType !== "hidden" && rawType !== "output") {
      fail("bad_field", `${where}.type must be "input", "hidden" or "output", not ${JSON.stringify(rawType)}.`);
    }
    const type = rawType as GenomeNode["type"];
    const activation = String(raw.activation ?? "tanh");
    const aggregation = String(raw.aggregation ?? "sum");
    if (type !== "input" && !(activation in GENOME_ACTIVATIONS)) {
      fail(
        "unknown_activation",
        `Node ${id} uses activation "${activation}", which isn't supported.`,
        `Supported: ${Object.keys(GENOME_ACTIVATIONS).join(", ")}.`,
      );
    }
    if (type !== "input" && !(aggregation in AGGREGATIONS)) {
      fail(
        "unknown_aggregation",
        `Node ${id} uses aggregation "${aggregation}", which isn't supported.`,
        `Supported: ${Object.keys(AGGREGATIONS).join(", ")}.`,
      );
    }
    nodes.set(id, {
      id,
      type,
      bias: type === "input" ? 0 : num(raw.bias ?? 0, `${where}.bias (node ${id})`),
      response: type === "input" ? 1 : num(raw.response ?? 1, `${where}.response (node ${id})`),
      activation: GENOME_ACTIVATIONS[activation as keyof typeof GENOME_ACTIVATIONS] ?? 0,
      aggregation: AGGREGATIONS[aggregation as keyof typeof AGGREGATIONS] ?? 0,
    });
  });

  // Inputs and outputs, in observation / action order.
  const declaredInputs = [...nodes.values()].filter((n) => n.type === "input").map((n) => n.id);
  const inputKeys = Array.isArray(data.inputKeys)
    ? data.inputKeys.map((v, i) => int(v, `inputKeys[${i}]`))
    : declaredInputs.length > 0
      ? orderInputs(declaredInputs)
      : impliedNeatInputs(rawConns, shape.inputs);
  const outputKeys = Array.isArray(data.outputKeys)
    ? data.outputKeys.map((v, i) => int(v, `outputKeys[${i}]`))
    : [...nodes.values()].filter((n) => n.type === "output").map((n) => n.id).sort((a, b) => a - b);

  if (inputKeys.length !== shape.inputs) {
    fail(
      "wrong_inputs",
      `The network takes ${inputKeys.length} inputs, not ${shape.inputs}.`,
      `Agents receive ${shape.inputs - 4} rays plus speed, progress, offset and heading. Check num_inputs in your config.`,
    );
  }
  if (outputKeys.length !== shape.outputs) {
    fail("wrong_outputs", `The network has ${outputKeys.length} outputs, not ${shape.outputs}.`, "Outputs are steer then throttle.");
  }
  for (const k of outputKeys) if (!nodes.has(k)) fail("bad_reference", `Output ${k} has no node entry.`);
  const inputSet = new Set(inputKeys);
  if (inputSet.size !== inputKeys.length) fail("duplicate_id", "An input id is listed twice.");
  for (const k of outputKeys) if (inputSet.has(k)) fail("bad_field", `Node ${k} can't be both an input and an output.`);

  // Expressed connections, in file order.
  const conns: { a: number; b: number; w: number }[] = [];
  rawConns.forEach((raw, i) => {
    const where = `connections[${i}]`;
    if (!isObject(raw)) return fail("bad_field", `${where} must be an object.`);
    const a = int(raw.in, `${where}.in`);
    const b = int(raw.out, `${where}.out`);
    const w = num(raw.weight, `${where}.weight (${a} → ${b})`);
    if (raw.enabled === false) return;
    if (!inputSet.has(a) && !nodes.has(a)) fail("bad_reference", `Connection ${a} → ${b} starts at a node that doesn't exist.`);
    if (!nodes.has(b)) fail("bad_reference", `Connection ${a} → ${b} ends at a node that doesn't exist.`);
    if (inputSet.has(b)) fail("bad_reference", `Connection ${a} → ${b} feeds into an input.`);
    conns.push({ a, b, w });
  });

  const loop = findLoop(conns);
  if (loop) {
    const path = loop.join(", which feeds ");
    fail(
      "loop",
      `Your network has a loop: node ${path}.`,
      "Agents must be feed-forward. In neat-python, set feed_forward = True and export again.",
    );
  }

  // neat-python 2.0 FeedForwardNetwork.create, step for step.
  const { layers, required } = feedForwardLayers(inputKeys, outputKeys, conns);
  const requiredWithInputs = new Set([...required, ...inputKeys]);

  const slotOf = new Map<number, number>();
  inputKeys.forEach((k, i) => slotOf.set(k, i));
  let next = inputKeys.length;
  for (const k of outputKeys) slotOf.set(k, next++);
  for (const layer of layers) for (const k of layer) if (!slotOf.has(k)) slotOf.set(k, next++);

  const program: ProgramNode[] = [];
  for (const layer of layers) {
    for (const k of layer) {
      const node = nodes.get(k)!;
      program.push({
        slot: slotOf.get(k)!,
        activation: node.activation,
        aggregation: node.aggregation,
        bias: node.bias,
        response: node.response,
        links: conns.filter((c) => c.b === k && requiredWithInputs.has(c.a)).map((c) => ({ slot: slotOf.get(c.a)!, weight: c.w })),
      });
    }
  }
  return {
    kind: "neat-genome",
    slotCount: next,
    inputSlots: inputKeys.map((k) => slotOf.get(k)!),
    outputSlots: outputKeys.map((k) => slotOf.get(k)!),
    nodes: program,
  };
}

/** neat-python numbers inputs -1, -2, ...: -1 is the first observation. Otherwise ascending ids. */
function orderInputs(ids: number[]): number[] {
  return ids.every((k) => k < 0) ? [...ids].sort((a, b) => b - a) : [...ids].sort((a, b) => a - b);
}

/** neat-python genomes don't list input nodes; they are -1 .. -n. */
function impliedNeatInputs(_conns: unknown[], count: number): number[] {
  return Array.from({ length: count }, (_, i) => -(i + 1));
}

function findLoop(conns: { a: number; b: number }[]): number[] | null {
  const out = new Map<number, number[]>();
  for (const c of conns) out.set(c.a, [...(out.get(c.a) ?? []), c.b]);
  const state = new Map<number, 1 | 2>(); // 1 = on stack, 2 = done
  const stack: number[] = [];
  const visit = (n: number): number[] | null => {
    state.set(n, 1);
    stack.push(n);
    for (const m of out.get(n) ?? []) {
      if (state.get(m) === 1) return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) {
        const found = visit(m);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of [...out.keys()].sort((a, b) => a - b)) {
    if (!state.has(n)) {
      const found = visit(n);
      if (found) return found;
    }
  }
  return null;
}

/** Port of neat.graphs.required_for_output and feed_forward_layers (neat-python 2.0). */
function feedForwardLayers(inputs: number[], outputs: number[], conns: { a: number; b: number }[]) {
  const inputSet = new Set(inputs);
  const required = new Set(outputs);
  let s = new Set(outputs);
  while (true) {
    const t = new Set(conns.filter((c) => s.has(c.b) && !s.has(c.a)).map((c) => c.a));
    if (t.size === 0) break;
    const layerNodes = [...t].filter((x) => !inputSet.has(x));
    if (layerNodes.length === 0) break;
    for (const x of layerNodes) required.add(x);
    s = new Set([...s, ...t]);
  }

  const withInputs = new Set(conns.map((c) => c.b));
  const biasNeurons = [...required].filter((n) => !withInputs.has(n)).sort((a, b) => a - b);
  const layers: number[][] = [];
  const ready = new Set([...inputs, ...biasNeurons]);
  if (biasNeurons.length) layers.push(biasNeurons);
  while (true) {
    const candidates = new Set(conns.filter((c) => ready.has(c.a) && !ready.has(c.b)).map((c) => c.b));
    const layer = [...candidates]
      .filter(
        (n) =>
          required.has(n) && conns.filter((c) => c.b === n && required.has(c.a)).every((c) => ready.has(c.a)),
      )
      .sort((a, b) => a - b);
    if (layer.length === 0) break;
    layers.push(layer);
    for (const n of layer) ready.add(n);
  }
  return { layers, required };
}

// ---------------------------------------------------------------- MLP

function compileMlp(data: Record<string, unknown>, shape: Shape): Program {
  const layers = (data.layers as unknown[]).map((v, i) => int(v, `layers[${i}]`));
  if (layers.length < 2 || layers.some((n) => n < 1)) fail("mlp_shape", "layers must list at least an input and an output size.");
  if (layers[0] !== shape.inputs) {
    fail("wrong_inputs", `The network takes ${layers[0]} inputs, not ${shape.inputs}.`, "Check the size of your first layer.");
  }
  if (layers.at(-1) !== shape.outputs) {
    fail("wrong_outputs", `The network has ${layers.at(-1)} outputs, not ${shape.outputs}.`, "Outputs are steer then throttle.");
  }
  const total = layers.slice(1).reduce((a, n) => a + n, 0);
  if (total > MAX_NODES) fail("too_big", `The MLP has ${total} neurons; the limit is ${MAX_NODES}.`);

  const act = (name: unknown, field: string): number => {
    const key = String(name ?? "tanh");
    if (!(key in MLP_ACTIVATIONS)) {
      fail("unknown_activation", `${field} "${key}" isn't supported.`, `Supported: ${Object.keys(MLP_ACTIVATIONS).join(", ")}.`);
    }
    return MLP_ACTIVATIONS[key as keyof typeof MLP_ACTIVATIONS];
  };
  const hidden = act(data.activation, "activation");
  const output = act(data.outputActivation ?? data.activation, "outputActivation");

  const weights = data.weights;
  const biases = data.biases;
  if (!Array.isArray(weights) || weights.length !== layers.length - 1) {
    fail("mlp_shape", `weights must have ${layers.length - 1} entries, one per layer after the input.`);
  }
  if (!Array.isArray(biases) || biases.length !== layers.length - 1) {
    fail("mlp_shape", `biases must have ${layers.length - 1} entries, one per layer after the input.`);
  }

  const nodes: ProgramNode[] = [];
  let prevStart = 0;
  let slot = shape.inputs;
  for (let l = 1; l < layers.length; l++) {
    const nIn = layers[l - 1]!;
    const nOut = layers[l]!;
    const w = (weights as unknown[])[l - 1];
    const b = (biases as unknown[])[l - 1];
    if (!Array.isArray(w) || w.length !== nIn * nOut) {
      fail("mlp_shape", `weights[${l - 1}] must have ${nIn} × ${nOut} = ${nIn * nOut} numbers, row-major [out][in].`);
    }
    if (!Array.isArray(b) || b.length !== nOut) fail("mlp_shape", `biases[${l - 1}] must have ${nOut} numbers.`);
    const start = slot;
    for (let j = 0; j < nOut; j++) {
      nodes.push({
        slot: slot++,
        activation: l === layers.length - 1 ? output : hidden,
        aggregation: AGGREGATIONS.sum,
        bias: num((b as unknown[])[j], `biases[${l - 1}][${j}]`),
        response: 1,
        links: Array.from({ length: nIn }, (_, i) => ({
          slot: l === 1 ? i : prevStart + i,
          weight: num((w as unknown[])[j * nIn + i], `weights[${l - 1}][${j * nIn + i}]`),
        })),
      });
    }
    prevStart = start;
  }
  return {
    kind: "mlp",
    slotCount: slot,
    inputSlots: Array.from({ length: shape.inputs }, (_, i) => i),
    outputSlots: Array.from({ length: shape.outputs }, (_, i) => prevStart + i),
    nodes,
  };
}

// ---------------------------------------------------------------- helpers

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail(
      "bad_field",
      `${field} is ${v === null ? "null" : JSON.stringify(v)}, not a number.`,
      "Look for missing biases or weights saved as null or NaN.",
    );
  }
  return v as number;
}

function int(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) fail("bad_field", `${field} must be an integer, not ${JSON.stringify(v)}.`);
  return v as number;
}
