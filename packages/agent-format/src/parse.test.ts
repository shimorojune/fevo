import assert from "node:assert/strict";
import { test } from "node:test";
import { AGGREGATIONS, GENOME_ACTIVATIONS } from "./functions.ts";
import { parseAgent, type ParseResult } from "./parse.ts";
import { evaluateReference } from "./reference.ts";
import { fingerprint, packProgram, parameterCount } from "./program.ts";

const SHAPE = { inputs: 15, outputs: 2 };

function ok(r: ParseResult) {
  if (!r.ok) assert.fail(r.errors.map((e) => e.message).join("; "));
  return r.program;
}
function err(r: ParseResult) {
  assert.equal(r.ok, false);
  return (r as { errors: { code: string; message: string; hint?: string }[] }).errors[0]!;
}

/** neat-python style: inputs -1..-15 not listed, outputs 0 and 1. */
function genome(extra: { nodes?: object[]; connections?: object[] } = {}) {
  return {
    nodes: [
      { id: 0, type: "output", bias: 0.1, response: 1, activation: "tanh", aggregation: "sum" },
      { id: 1, type: "output", bias: -0.2, response: 1, activation: "tanh", aggregation: "sum" },
      ...(extra.nodes ?? []),
    ],
    connections: [
      { in: -1, out: 0, weight: 0.8, enabled: true },
      { in: -12, out: 1, weight: 1.5, enabled: true },
      ...(extra.connections ?? []),
    ],
  };
}

test("neat-python genome compiles and evaluates with neat semantics", () => {
  const p = ok(parseAgent(JSON.stringify(genome()), SHAPE));
  const inputs = Array.from({ length: 15 }, (_, i) => i / 15);
  const [steer, throttle] = evaluateReference(p, inputs);
  assert.equal(steer, Math.tanh(2.5 * (0.1 + 0.8 * inputs[0]!)));
  assert.equal(throttle, Math.tanh(2.5 * (-0.2 + 1.5 * inputs[11]!)));
  assert.equal(parameterCount(p), 4);
});

test("design-spec genome with listed inputs 0..14 and outputs 15, 16", () => {
  const nodes = [
    ...Array.from({ length: 15 }, (_, i) => ({ id: i, type: "input" })),
    { id: 15, type: "output", bias: 0.1, activation: "tanh" },
    { id: 16, type: "output", bias: 0, activation: "identity" },
  ];
  const p = ok(parseAgent(JSON.stringify({ nodes, connections: [{ in: 3, out: 15, weight: 0.8 }] }), SHAPE));
  const inputs = Array.from({ length: 15 }, (_, i) => i);
  assert.deepEqual(evaluateReference(p, inputs), [Math.tanh(2.5 * (0.1 + 0.8 * 3)), 0]);
});

test("unconnected required node is a bias neuron, as in neat-python 2.0", () => {
  // Output 1 has no inputs: it outputs activation(bias).
  const g = genome();
  g.connections.pop();
  const p = ok(parseAgent(JSON.stringify(g), SHAPE));
  assert.equal(evaluateReference(p, new Array(15).fill(0))[1], Math.tanh(2.5 * -0.2));
});

test("disabled connections and dead hidden nodes are ignored", () => {
  const g = genome({
    nodes: [{ id: 7, bias: 1, activation: "relu" }],
    connections: [
      { in: -2, out: 0, weight: 100, enabled: false },
      { in: -3, out: 7, weight: 1 }, // 7 feeds nothing
    ],
  });
  const p = ok(parseAgent(JSON.stringify(g), SHAPE));
  assert.equal(p.nodes.length, 2);
});

test("hidden layers evaluate in dependency order", () => {
  const g = genome({
    nodes: [
      { id: 5, bias: 0, activation: "relu", aggregation: "max" },
      { id: 6, bias: 0.5, activation: "sigmoid", aggregation: "product" },
    ],
    connections: [
      { in: 5, out: 0, weight: 1 },
      { in: 6, out: 5, weight: 2 },
      { in: -4, out: 6, weight: 1 },
      { in: -5, out: 6, weight: -1 },
    ],
  });
  const p = ok(parseAgent(JSON.stringify(g), SHAPE));
  const x = Array.from({ length: 15 }, (_, i) => (i + 1) / 10);
  const n6 = 1 / (1 + Math.exp(-5 * (0.5 + x[3]! * 1 * (x[4]! * -1))));
  const n5 = Math.max(0, Math.max(n6 * 2));
  const out0 = Math.tanh(2.5 * (0.1 + (0.8 * x[0]! + n5 * 1)));
  assert.equal(evaluateReference(p, x)[0], out0);
});

test("loops are rejected with the path", () => {
  const g = genome({
    nodes: [{ id: 17 }, { id: 23 }],
    connections: [
      { in: 17, out: 23, weight: 1 },
      { in: 23, out: 17, weight: 1 },
      { in: 17, out: 0, weight: 1 },
    ],
  });
  const e = err(parseAgent(JSON.stringify(g), SHAPE));
  assert.equal(e.code, "loop");
  assert.match(e.message, /node 17, which feeds 23, which feeds 17/);
  assert.match(e.hint!, /feed_forward = True/);
});

test("wrong input count names the expected shape", () => {
  const e = err(parseAgent(JSON.stringify({ ...genome(), inputKeys: [-1, -2, -3] }), SHAPE));
  assert.equal(e.code, "wrong_inputs");
  assert.equal(e.message, "The network takes 3 inputs, not 15.");
});

test("null weights and NaN biases are reported by field", () => {
  const g = genome();
  (g.connections[0] as { weight: unknown }).weight = null;
  const e = err(parseAgent(JSON.stringify(g), SHAPE));
  assert.equal(e.code, "bad_field");
  assert.match(e.message, /connections\[0\]\.weight .* is null/);
});

test("invalid JSON reports line and column", () => {
  const e = err(parseAgent('{\n  "nodes": [1,\n  ],\n}', SHAPE));
  assert.equal(e.code, "invalid_json");
  assert.match(e.message, /Line \d+, column \d+/);
});

test("unknown activation lists the supported ones", () => {
  const g = genome();
  (g.nodes[0] as { activation: string }).activation = "swish";
  const e = err(parseAgent(JSON.stringify(g), SHAPE));
  assert.equal(e.code, "unknown_activation");
  assert.match(e.hint!, /sigmoid, tanh/);
});

test("files over 500 KB are rejected before parsing", () => {
  assert.equal(err(parseAgent(" ".repeat(600 * 1024), SHAPE)).code, "too_large");
});

test("MLP 15-32-2 compiles row-major [out][in] with standard tanh", () => {
  const w0 = Array.from({ length: 32 * 15 }, (_, k) => Math.sin(k) * 0.1);
  const w1 = Array.from({ length: 2 * 32 }, (_, k) => Math.cos(k) * 0.1);
  const mlp = { layers: [15, 32, 2], activation: "tanh", weights: [w0, w1], biases: [new Array(32).fill(0.01), [0, 0.5]] };
  const p = ok(parseAgent(JSON.stringify(mlp), SHAPE));
  assert.equal(parameterCount(p), 15 * 32 + 32 + 32 * 2 + 2);
  const x = Array.from({ length: 15 }, (_, i) => i / 15);
  const h = Array.from({ length: 32 }, (_, j) => Math.tanh(0.01 + x.reduce((a, xi, i) => a + xi * w0[j * 15 + i]!, 0)));
  const o = [0, 1].map((j) => Math.tanh([0, 0.5][j]! + h.reduce((a, hi, i) => a + hi * w1[j * 32 + i]!, 0)));
  assert.deepEqual(evaluateReference(p, x), o);
});

test("MLP shape mistakes are explained", () => {
  const e = err(parseAgent(JSON.stringify({ layers: [13, 8, 2], weights: [], biases: [] }), SHAPE));
  assert.equal(e.message, "The network takes 13 inputs, not 15.");
  const e2 = err(parseAgent(JSON.stringify({ layers: [15, 2], weights: [[1, 2]], biases: [[0, 0]] }), SHAPE));
  assert.equal(e2.code, "mlp_shape");
});

test("packing and fingerprint are stable", async () => {
  const p = ok(parseAgent(JSON.stringify(genome()), SHAPE));
  const packed = packProgram(p);
  assert.equal(packed.io.length, 17);
  assert.equal(packed.nodeInts.length, p.nodes.length * 5);
  const a = await fingerprint(p);
  const b = await fingerprint(ok(parseAgent(JSON.stringify(genome(), null, 2), SHAPE)));
  assert.equal(a, b, "whitespace doesn't change the fingerprint");
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("function code tables have no collisions", () => {
  const codes = [...Object.values(GENOME_ACTIVATIONS)];
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(new Set(Object.values(AGGREGATIONS)).size, Object.keys(AGGREGATIONS).length);
});
