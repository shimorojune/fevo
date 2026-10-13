import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GENOME_ACTIVATIONS, AGGREGATIONS, evaluateReference, parseAgent, type Program } from "@fevo/agent-format";
import * as core from "@fevo/sim-core";
import { loadAgent } from "../src/index.ts";

const SHAPE = { inputs: 15, outputs: 2 };

function compile(text: string): Program {
  const r = parseAgent(text, SHAPE);
  if (!r.ok) assert.fail(r.errors.map((e) => e.message).join("; "));
  return r.program;
}

function wasmEval(inputs: number[]): [number, number] {
  core.evaluateAgent(Float64Array.from(inputs));
  return [core.getAgentSteer(), core.getAgentThrottle()];
}

/** Same value up to a few ULPs: Python, V8 and AssemblyScript libm differ in the last bits. */
function close(a: number, b: number, msg: string): void {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return;
  const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
}

test("wasm matches real neat-python 2.0 on evolved genomes", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/neat-python.json", import.meta.url), "utf8"));
  let checked = 0;
  fixture.cases.forEach((c: { genome: object; samples: { inputs: number[]; outputs: number[] }[] }, gi: number) => {
    const program = compile(JSON.stringify(c.genome));
    loadAgent(program);
    for (const s of c.samples) {
      const out = wasmEval(s.inputs);
      close(out[0], s.outputs[0]!, `genome ${gi} steer`);
      close(out[1], s.outputs[1]!, `genome ${gi} throttle`);
      checked++;
    }
  });
  assert.ok(checked >= 300, `checked ${checked} samples`);
});

test("wasm matches the JS reference on random genomes using every function", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const acts = Object.keys(GENOME_ACTIVATIONS);
  const aggs = Object.keys(AGGREGATIONS);
  for (let g = 0; g < 60; g++) {
    const hidden = Array.from({ length: 6 }, (_, i) => ({
      id: 10 + i,
      bias: rand(),
      response: 1 + rand() * 0.5,
      activation: acts[(g * 7 + i) % acts.length],
      aggregation: aggs[(g + i) % aggs.length],
    }));
    const conns = [];
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 3; k++) conns.push({ in: -1 - ((g + i * 3 + k) % 15), out: 10 + i, weight: rand() * 2 });
      if (i > 0) conns.push({ in: 10 + i - 1, out: 10 + i, weight: rand() });
    }
    conns.push({ in: 15, out: 0, weight: rand() }, { in: 13, out: 1, weight: rand() }, { in: -3, out: 1, weight: rand() });
    const genome = {
      nodes: [
        { id: 0, type: "output", bias: rand(), activation: acts[g % acts.length], aggregation: "sum" },
        { id: 1, type: "output", bias: rand(), activation: "clamped", aggregation: aggs[g % aggs.length] },
        ...hidden,
      ],
      connections: conns,
    };
    const program = compile(JSON.stringify(genome));
    loadAgent(program);
    for (let s = 0; s < 10; s++) {
      const x = Array.from({ length: 15 }, () => rand());
      const ref = evaluateReference(program, x);
      const out = wasmEval(x);
      close(out[0], ref[0]!, `genome ${g} steer`);
      close(out[1], ref[1]!, `genome ${g} throttle`);
    }
  }
});

test("MLP in the wasm matches the reference", () => {
  const w0 = Array.from({ length: 32 * 15 }, (_, k) => Math.sin(k * 1.3) * 0.4);
  const w1 = Array.from({ length: 2 * 32 }, (_, k) => Math.cos(k * 0.7) * 0.4);
  const program = compile(
    JSON.stringify({ layers: [15, 32, 2], activation: "relu", outputActivation: "tanh", weights: [w0, w1], biases: [new Array(32).fill(0.05), [0.1, 0.2]] }),
  );
  loadAgent(program);
  const x = Array.from({ length: 15 }, (_, i) => Math.sin(i));
  const ref = evaluateReference(program, x);
  const out = wasmEval(x);
  close(out[0], ref[0]!, "steer");
  close(out[1], ref[1]!, "throttle");
});
