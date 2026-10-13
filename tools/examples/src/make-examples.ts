/**
 * Build examples/example-genome.json and examples/example-mlp.json: tiny
 * hand-structured agents whose few weights are tuned by random search so they
 * finish laps. They exist to show the file formats and give the site a demo,
 * not to be fast.
 *
 *   pnpm --filter @fevo/examples-builder build-examples
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseAgent, type Program } from "@fevo/agent-format";
import { SOLO_1 as R } from "@fevo/rules";
import { configure, formatLapTime, loadAgent, loadTrack, runLap } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";

const root = new URL("../../../", import.meta.url);
const track = (id: string): TrackFile =>
  JSON.parse(readFileSync(new URL(`packages/tracks/data/${id}.track.json`, root), "utf8"));
const TRACKS = ["spielberg", "monza", "austin"].map(track);

// Observation indices (rules solo-1): rays 0..10 left to right, 11 speed, 12 progress, 13 offset, 14 heading.
// neat-python input ids are -(index + 1).
const id = (obs: number) => -(obs + 1);

/** p: [heading, offset, rayBalance, throttleBias, aheadGain, speedGain, diagGain] */
function genomeFrom(p: number[]) {
  const [kh, ko, kb, tb, ta, ts, td] = p as [number, number, number, number, number, number, number];
  return {
    inputKeys: Array.from({ length: 15 }, (_, i) => id(i)),
    outputKeys: [0, 1],
    nodes: [
      { id: 0, type: "output", bias: 0, response: 1, activation: "tanh", aggregation: "sum" },
      { id: 1, type: "output", bias: tb, response: 1, activation: "tanh", aggregation: "sum" },
    ],
    connections: [
      // Steer (+ right): turn back towards the track direction and centre line, and towards open space.
      { in: id(14), out: 0, weight: -kh, enabled: true },
      { in: id(13), out: 0, weight: -ko, enabled: true },
      { in: id(2), out: 0, weight: -kb, enabled: true },
      { in: id(8), out: 0, weight: kb, enabled: true },
      // Throttle: open road ahead means go, speed means lift.
      { in: id(5), out: 1, weight: ta, enabled: true },
      { in: id(4), out: 1, weight: td, enabled: true },
      { in: id(6), out: 1, weight: td, enabled: true },
      { in: id(11), out: 1, weight: -ts, enabled: true },
    ],
  };
}

/** Same controller as a 15-4-2 MLP: hidden units carry the signals in tanh's near-linear range. */
function mlpFrom(p: number[]) {
  const [kh, ko, kb, tb, ta, ts, td] = p as [number, number, number, number, number, number, number];
  const s = 0.25; // hidden pre-scale; output weights undo it
  const w0 = new Array(4 * 15).fill(0);
  const set = (h: number, obs: number, v: number) => (w0[h * 15 + obs] = v * s);
  set(0, 14, -kh);
  set(0, 13, -ko);
  set(0, 2, -kb);
  set(0, 8, kb);
  set(1, 5, ta);
  set(1, 4, td);
  set(1, 6, td);
  set(1, 11, -ts);
  const w1 = [1 / s, 0, 0, 0, 0, 1 / s, 0, 0];
  return { layers: [15, 4, 2], activation: "tanh", weights: [w0, w1], biases: [[0, 0, 0, 0], [0, tb]] };
}

function compile(file: object): Program {
  const r = parseAgent(JSON.stringify(file), { inputs: 15, outputs: 2 });
  if (!r.ok) throw new Error(r.errors[0]!.message);
  return r.program;
}

/** Lower is better: total steps over every circuit and seed, heavy penalty per gate short. */
function score(program: Program, tracks: TrackFile[]): number {
  let total = 0;
  for (const t of tracks) {
    loadTrack(t);
    loadAgent(program);
    for (let seed = 0; seed < R.seeds.length; seed++) {
      const lap = runLap(R, seed);
      total += lap.status === "finished" ? lap.steps : 50_000 + (t.gates.length - lap.gatesPassed) * 2_000;
    }
  }
  return total;
}

/** (1+1) evolution strategy with the 1/5th success rule. Deterministic: fixed seed. */
function search(build: (p: number[]) => object, start: number[], iterations: number): number[] {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
  const gauss = () => (rand() + rand() + rand()) / 1.5;
  let best = start;
  let bestScore = score(compile(build(best)), TRACKS);
  let sigma = 0.2;
  for (let i = 0; i < iterations; i++) {
    const cand = best.map((v) => v * Math.exp(sigma * gauss()));
    const s = score(compile(build(cand)), TRACKS);
    if (s < bestScore) {
      best = cand;
      bestScore = s;
      sigma *= 1.5;
      console.log(`  ${i}: ${s} sigma ${sigma.toFixed(3)}`);
    } else {
      sigma = Math.max(0.02, sigma * 0.9);
    }
  }
  return best;
}

configure(R);
// Starting point from reasoning about the units: heading error is angle / π,
// offset is metres / half-width, rays are distance / 200 m, speed is m/s / 100.
const start = process.env.START ? JSON.parse(process.env.START) : [4, 0.5, 3, 0.15, 6, 7, 0.5];
const iterations = Number(process.env.ITER ?? 400);
let tuned = start;
for (const [name, build] of [
  ["genome", genomeFrom],
  ["mlp", mlpFrom],
] as const) {
  console.log(`tuning example-${name}`);
  const p = search(build, tuned, name === "genome" ? iterations : Math.round(iterations / 4));
  tuned = p;
  const file = build(p);
  writeFileSync(new URL(`examples/example-${name}.json`, root), JSON.stringify(file, null, 1) + "\n");
  const program = compile(file);
  for (const t of TRACKS) {
    loadTrack(t);
    loadAgent(program);
    const laps = R.seeds.map((_, s) => runLap(R, s));
    console.log(
      `  ${t.circuitId}: ${laps.map((l) => (l.status === "finished" ? formatLapTime(l.steps, R.timing.agentHz) : `${l.status} at gate ${l.gatesPassed}`)).join(", ")}`,
    );
  }
}
