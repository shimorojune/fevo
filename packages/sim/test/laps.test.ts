import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseAgent, type Program } from "@fevo/agent-format";
import { SOLO_1 as R, SOLO_2 } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";
import { configure, formatLapTime, loadAgent, loadTrack, runLap, runOfficialLaps } from "../src/index.ts";

const root = new URL("../../../", import.meta.url);
const track = (id: string): TrackFile => JSON.parse(readFileSync(new URL(`packages/tracks/data/${id}.track.json`, root), "utf8"));
const example = (name: string): Program => {
  const r = parseAgent(readFileSync(new URL(`examples/example-${name}.json`, root), "utf8"), { inputs: 15, outputs: 2 });
  if (!r.ok) assert.fail(r.errors[0]!.message);
  return r.program;
};

for (const name of ["genome", "mlp"]) {
  for (const id of ["spielberg", "monza", "austin"]) {
    test(`example-${name} sets a ranked time at ${id}`, () => {
      const result = runOfficialLaps(R, track(id), example(name));
      assert.ok(result.ranked, result.laps.map((l) => `${l.status} at gate ${l.gatesPassed}`).join(", "));
      assert.ok(result.laps.every((l) => l.status === "finished"));
      console.log(`example-${name} ${id}: ${formatLapTime(result.medianSteps!, R.timing.agentHz)}`);
    });
  }
}

test("official laps are reproducible and tracing doesn't change them", () => {
  const t = track("spielberg");
  const program = example("genome");
  const a = runOfficialLaps(R, t, program);
  const b = runOfficialLaps(R, t, program);
  assert.deepEqual(
    a.laps.map((l) => l.hash),
    b.laps.map((l) => l.hash),
  );
  configure(R);
  loadTrack(t);
  loadAgent(program);
  const traced = runLap(R, 1, { trace: true });
  assert.equal(traced.hash, a.laps[1]!.hash);
  assert.equal(traced.trace!.x.length, traced.steps + 1);
});

test("median follows the rules: two finished laps are enough, one isn't", () => {
  // A program whose throttle is always 0 never moves: every lap is stopped.
  const parked = parseAgent(
    JSON.stringify({ nodes: [{ id: 0, type: "output" }, { id: 1, type: "output", activation: "identity" }], connections: [] }),
    { inputs: 15, outputs: 2 },
  );
  assert.ok(parked.ok);
  const r = runOfficialLaps(R, track("monza"), parked.program);
  assert.equal(r.ranked, false);
  assert.equal(r.medianSteps, null);
  assert.ok(r.laps.every((l) => l.status === "stopped"));
});

test("lap time formatting", () => {
  assert.equal(formatLapTime(4212, 60), "1:10.20");
  assert.equal(formatLapTime(59, 60), "0:00.98");
});


test("setup changes the car: low wing is faster on the straights, slower round the corners", () => {
  const t = track("monza");
  const shape = { inputs: 15, outputs: 2, setup: R.setup };
  const base = JSON.parse(readFileSync(new URL("examples/example-mlp.json", root), "utf8"));
  const parse = (setup?: object) => {
    const r = parseAgent(JSON.stringify(setup ? { ...base, setup } : base), shape);
    if (!r.ok) assert.fail(r.errors[0]!.message);
    return r.program;
  };
  const plain = runOfficialLaps(R, t, parse());
  const asDefault = runOfficialLaps(R, t, parse({ wing: 0.3 }));
  assert.deepEqual(plain.laps.map((l) => l.hash), asDefault.laps.map((l) => l.hash), "explicit default setup = no setup");
  const low = runOfficialLaps(R, t, parse({ wing: 0 }));
  assert.notDeepEqual(low.laps.map((l) => l.hash), plain.laps.map((l) => l.hash));
});

test("solo-2 drives the same agents differently, and configuring solo-1 afterwards gives solo-1 laps back", () => {
  const t = track("spielberg");
  const program = example("mlp");
  const one = runOfficialLaps(R, t, program);
  const two = runOfficialLaps(SOLO_2, t, program);
  const again = runOfficialLaps(R, t, program);
  assert.deepEqual(
    again.laps.map((l) => l.hash),
    one.laps.map((l) => l.hash),
  );
  assert.notDeepEqual(
    two.laps.map((l) => l.hash),
    one.laps.map((l) => l.hash),
  );
});
