// Full laps on the baked tracks with a scripted pure-pursuit driver.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { SOLO_1, packCarParams } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";
import * as sim from "../build/sim.js";

const R = SOLO_1;
const HZ = R.timing.agentHz;
const RAYS = R.sensors.rayCount;
const G = R.car.gravityMps2;

function loadTrackFile(id: string): TrackFile {
  return JSON.parse(readFileSync(new URL(`../../tracks/data/${id}.track.json`, import.meta.url), "utf8"));
}

function load(t: TrackFile): void {
  sim.loadTrack(
    Float64Array.from(t.centerline),
    Float64Array.from(t.widthLeft),
    Float64Array.from(t.widthRight),
    Int32Array.from(t.gates),
  );
}

before(() => {
  sim.setCarParams(packCarParams(R.car));
  sim.setTiming(HZ, R.timing.physicsSubsteps);
  sim.setLimits(R.timing.maxSteps, R.timing.stopSpeedMps, R.timing.stopSteps);
  sim.setSensors(RAYS, R.sensors.rayLengthM, R.sensors.rayFovRad, R.sensors.speedNormMps);
});

function startSeed(i: number): void {
  const s = R.seeds[i]!;
  sim.resetAtStart(s.lateralM, s.headingRad, R.start.initialSpeedMps);
}

/** Signed centreline curvature (left positive) and a conservative target speed per point. */
function speedProfile(t: TrackFile): { k: Float64Array; v: Float64Array } {
  const n = t.widthLeft.length;
  const x = (i: number) => t.centerline[2 * (((i % n) + n) % n)]!;
  const y = (i: number) => t.centerline[2 * (((i % n) + n) % n) + 1]!;
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Heading change between the chords either side, over the 5 m between their midpoints.
    const h1 = Math.atan2(y(i) - y(i - 5), x(i) - x(i - 5));
    const h2 = Math.atan2(y(i + 5) - y(i), x(i + 5) - x(i));
    let d = h2 - h1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    k[i] = d / 5;
  }
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Use the tightest curvature nearby so the script is already slow at the apex.
    let kMax = 0;
    for (let j = -20; j <= 20; j++) kMax = Math.max(kMax, Math.abs(k[(i + j + n) % n]!));
    const q = (rho: number, vv: number) => 0.5 * rho * vv * vv;
    // Lateral grip grows with downforce: solve v² k = μ (g + q(v) ClA / m) · margin by fixed-point iteration.
    let vv = 30;
    for (let it = 0; it < 20; it++) {
      const grip = 0.85 * R.car.tyreMuFront * (G + (q(R.car.airDensityKgM3, vv) * R.car.downforceAreaM2) / R.car.massKg);
      vv = Math.min(90, Math.sqrt(grip / Math.max(kMax, 1e-6)));
    }
    v[i] = vv;
  }
  // Braking: v_i <= sqrt(v_{i+1}^2 + 2 a ds), twice round the loop.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i]!, Math.sqrt(v[(i + 1) % n]! ** 2 + 2 * 3.5 * G * t.spacingM));
  }
  return { k, v };
}

function drive(t: TrackFile, seed: number): { status: number; steps: number; hash: bigint } {
  const n = t.widthLeft.length;
  const profile = speedProfile(t);
  const L = R.car.wheelbaseM;
  startSeed(seed);
  let status = sim.STATUS_RUNNING.value;
  while (status === sim.STATUS_RUNNING.value) {
    // Stanley steering from what an agent also sees: heading error and offset, plus curvature feed-forward.
    const idx = sim.getProgressIndex();
    const v = sim.getVx();
    const half = (t.widthLeft[idx]! + t.widthRight[idx]!) / 2;
    const headingErr = sim.getObservation(RAYS + 3) * Math.PI; // + means pointing right of the track
    const offsetLeft = -sim.getObservation(RAYS + 2) * half; // + means left of the centreline
    const kAhead = profile.k[(idx + Math.round((0.3 * v) / t.spacingM)) % n]!;
    const feedForward = Math.atan(L * kAhead);
    const delta = headingErr + Math.atan((-4 * offsetLeft) / (v + 2)) + feedForward;
    const steer = -delta / R.car.maxSteerRad; // the API's steer is positive to the right

    // No traction control in the sim, so the script feeds in only the power the rear tyres can spare.
    const q = 0.5 * R.car.airDensityKgM3 * v * v;
    const rearLoad =
      (R.car.massKg * G * R.car.cgToFrontM) / R.car.wheelbaseM + q * R.car.downforceAreaM2 * (1 - R.car.aeroBalanceFront);
    const latShare = Math.min(1, (v * v * Math.abs(kAhead)) / (R.car.tyreMuFront * (G + (q * R.car.downforceAreaM2) / R.car.massKg)));
    const spare = Math.sqrt(Math.max(0, 1 - latShare * latShare));
    const usable = Math.min(1, (0.8 * spare * R.car.tyreMuRear * rearLoad * Math.max(v, 1)) / R.car.powerW);
    const vt = profile.v[(idx + Math.round((0.3 * v) / t.spacingM)) % n]!;
    // No ABS either: brake only as hard as the tyres can take before locking up.
    const loadF = (R.car.massKg * G * (R.car.wheelbaseM - R.car.cgToFrontM)) / R.car.wheelbaseM + q * R.car.downforceAreaM2 * R.car.aeroBalanceFront;
    const maxBrake = Math.min(
      (R.car.tyreMuFront * loadF) / R.car.brakeBiasFront,
      (R.car.tyreMuRear * rearLoad) / (1 - R.car.brakeBiasFront),
    );
    const brakeLimit = Math.min(1, (0.9 * maxBrake) / R.car.maxBrakeForceN);
    const throttle = Math.max(-brakeLimit, Math.min(usable, (vt - v) * 0.4));
    status = sim.step(steer, throttle);
  }
  return { status, steps: sim.getSteps(), hash: sim.stateHash() };
}

const lapTime = (steps: number) => `${Math.floor(steps / HZ / 60)}:${((steps / HZ) % 60).toFixed(2).padStart(5, "0")}`;

for (const id of ["spielberg", "monza", "austin"]) {
  test(`${id}: scripted driver finishes from all three seeds`, () => {
    const t = loadTrackFile(id);
    load(t);
    for (let seed = 0; seed < 3; seed++) {
      const r = drive(t, seed);
      const name = ["RUNNING", "FINISHED", "CRASHED", "STOPPED", "ERROR", "TIMED_OUT"][r.status];
      assert.equal(r.status, sim.STATUS_FINISHED.value, `seed ${seed}: ${name} at gate ${sim.getGatesPassed()}/${t.gates.length}`);
      assert.equal(sim.getGatesPassed(), t.gates.length - 1);
      const seconds = r.steps / HZ;
      // Real pole times are roughly 1:04 / 1:19 / 1:33. A cautious script with a standing start is slower.
      assert.ok(seconds * 1000 > t.lengthM * 8 && seconds * 1000 < t.lengthM * 30, `${id} seed ${seed}: ${lapTime(r.steps)}`);
      console.log(`${id} seed ${seed}: ${lapTime(r.steps)} (${r.steps} steps)`);
    }
  });

  test(`${id}: the same scripted driver laps solo-2 (combined-slip rears) within 2% of solo-1`, () => {
    const t = loadTrackFile(id);
    load(t);
    for (let seed = 0; seed < 3; seed++) {
      const solo1 = drive(t, seed).steps;
      sim.setRearSlideModel(1, 0.9);
      try {
        const r = drive(t, seed);
        assert.equal(r.status, sim.STATUS_FINISHED.value, `seed ${seed}: status ${r.status} at gate ${sim.getGatesPassed()}/${t.gates.length}`);
        assert.ok(Math.abs(r.steps - solo1) < 0.02 * solo1, `seed ${seed}: ${lapTime(r.steps)} vs solo-1 ${lapTime(solo1)}`);
      } finally {
        sim.setRearSlideModel(0, 1);
      }
    }
  });
}

test("laps are bit-identical when repeated", () => {
  const t = loadTrackFile("spielberg");
  load(t);
  const a = drive(t, 1);
  const b = drive(t, 1);
  assert.equal(a.steps, b.steps);
  assert.equal(a.hash, b.hash);
});

test("observation at the start matches the track geometry", () => {
  const t = loadTrackFile("spielberg");
  load(t);
  startSeed(1); // no nudge
  const len = R.sensors.rayLengthM;
  assert.ok(Math.abs(sim.getObservation(0) * len - t.widthLeft[0]!) < 0.05, "left ray hits the left edge");
  assert.ok(Math.abs(sim.getObservation(RAYS - 1) * len - t.widthRight[0]!) < 0.05, "right ray hits the right edge");
  assert.ok(sim.getObservation((RAYS - 1) / 2) > 0.5, "forward ray sees down the straight");
  assert.equal(sim.getObservation(RAYS), 0, `standing start, speed obs ${sim.getObservation(RAYS)}`);
  assert.equal(sim.getObservation(RAYS + 1), 0, "no gates yet");
  assert.ok(Math.abs(sim.getObservation(RAYS + 2)) < 1e-9);

  startSeed(2); // 0.5 m right, 0.005 rad right
  const half = (t.widthLeft[0]! + t.widthRight[0]!) / 2;
  assert.ok(Math.abs(sim.getObservation(RAYS + 2) - 0.5 / half) < 1e-6, "offset is positive to the right");
  assert.ok(Math.abs(sim.getObservation(RAYS + 3) - 0.005 / Math.PI) < 1e-6, "heading error is positive to the right");
});

test("driving straight on leaves the track", () => {
  load(loadTrackFile("spielberg"));
  startSeed(1);
  let s = sim.STATUS_RUNNING.value;
  while (s === sim.STATUS_RUNNING.value) s = sim.step(0, 1);
  assert.equal(s, sim.STATUS_CRASHED.value);
});

test("a car that never moves is stopped after two seconds", () => {
  load(loadTrackFile("spielberg"));
  startSeed(1);
  let s = sim.STATUS_RUNNING.value;
  while (s === sim.STATUS_RUNNING.value) s = sim.step(0, 0);
  assert.equal(s, sim.STATUS_STOPPED.value);
  assert.equal(sim.getSteps(), R.timing.stopSteps);
});

test("NaN ends the lap with an error and later steps do nothing", () => {
  load(loadTrackFile("spielberg"));
  startSeed(1);
  assert.equal(sim.step(Number.NaN, 1), sim.STATUS_ERROR.value);
  const steps = sim.getSteps();
  assert.equal(sim.step(0, 1), sim.STATUS_ERROR.value);
  assert.equal(sim.getSteps(), steps);
});

/** One step from a point on Spielberg's start straight, `fromLeftEdge` metres inside (+) or past (−) the left edge. */
function besideLeftEdge(limits: number, fromLeftEdge: number): number {
  const t = loadTrackFile("spielberg");
  load(t);
  const i = 120;
  sim.setTrackLimits(limits);
  try {
    // resetAtPoint takes the offset to the right of the centre line.
    sim.resetAtPoint(i, -(t.widthLeft[i]! - fromLeftEdge), 0, 20);
    return sim.step(0, 0);
  } finally {
    sim.setTrackLimits(sim.LIMITS_ALL_CORNERS.value);
  }
}

test("all-corners limit (solo-1, solo-2): any corner of the body over the edge ends the lap", () => {
  const hw = R.car.widthM / 2;
  assert.equal(besideLeftEdge(sim.LIMITS_ALL_CORNERS.value, hw + 0.2), sim.STATUS_RUNNING.value);
  assert.equal(besideLeftEdge(sim.LIMITS_ALL_CORNERS.value, 0.5), sim.STATUS_CRASHED.value);
});

test("one-tyre limit (solo-3): legal while any tyre touches the track, off when all four are past the edge", () => {
  const hw = R.car.widthM / 2;
  assert.equal(besideLeftEdge(sim.LIMITS_ONE_TYRE.value, 0.5), sim.STATUS_RUNNING.value);
  // Centre just under a car's half width past the line: the inner tyres' outer edges still touch it.
  assert.equal(besideLeftEdge(sim.LIMITS_ONE_TYRE.value, -(hw - 0.2)), sim.STATUS_RUNNING.value);
  assert.equal(besideLeftEdge(sim.LIMITS_ONE_TYRE.value, -(hw + 0.25)), sim.STATUS_CRASHED.value);
});

test("the simulator rejects unknown track limits", () => {
  assert.throws(() => sim.setTrackLimits(2));
  sim.setTrackLimits(sim.LIMITS_ALL_CORNERS.value);
});

test("the standard observation set is the rules' 15 numbers; the extended set adds 13 after them", () => {
  const t = loadTrackFile("spielberg");
  load(t);
  const run = (set: number) => {
    sim.setObservationSet(set);
    try {
      startSeed(1);
      for (let i = 0; i < 300; i++) sim.step(0.05 * Math.sin(i / 20), i < 200 ? 0.6 : -0.3);
      return Array.from({ length: sim.getObservationCount() }, (_, i) => sim.getObservation(i));
    } finally {
      sim.setObservationSet(sim.OBS_STANDARD.value);
    }
  };
  const std = run(sim.OBS_STANDARD.value);
  const ext = run(sim.OBS_EXTENDED.value);
  assert.equal(std.length, RAYS + 4);
  assert.equal(ext.length, RAYS + 4 + sim.EXTRA_OBS.value);
  assert.deepEqual(ext.slice(0, RAYS + 4), std, "the standard numbers don't depend on the set");
  for (const v of ext) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1);
  assert.throws(() => sim.getObservation(RAYS + 4));
});

test("extended observation at the start: inside both edges, no slides, progress near zero, a corner ahead", () => {
  const t = loadTrackFile("spielberg");
  load(t);
  sim.setObservationSet(sim.OBS_EXTENDED.value);
  try {
    startSeed(1);
    sim.step(0, 0);
    const b = RAYS + 4, o = (k: number) => sim.getObservation(b + k);
    assert.ok(o(6) > 0 && o(7) > 0, `margins ${o(6)} ${o(7)}`);
    assert.equal(o(3), 0);
    assert.equal(o(4), 0);
    assert.ok(o(12) >= 0 && o(12) < 0.01);
    // The start straight is ~430 m long: nothing ahead within 200 m here. From 260 m, T1 (a tight right-hander
    // at about 430-470 m) is 200 m ahead, and right turns read positive.
    assert.ok([8, 9, 10, 11].every((k) => Math.abs(o(k)) < 0.05), "straight ahead of the start line");
    sim.resetAtPoint(260, 0, 0, 30);
    sim.step(0, 0);
    assert.ok(o(11) > 0.5, `T1 200 m ahead: ${[8, 9, 10, 11].map((k) => o(k).toFixed(2))}`);
    assert.ok([8, 9].every((k) => Math.abs(o(k)) < 0.05), "still straight 50-100 m ahead");
  } finally {
    sim.setObservationSet(sim.OBS_STANDARD.value);
  }
  assert.throws(() => sim.setObservationSet(2));
  sim.setObservationSet(sim.OBS_STANDARD.value);
});
