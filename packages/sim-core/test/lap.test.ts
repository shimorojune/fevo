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
    const throttle = Math.max(-1, Math.min(usable, (vt - v) * 0.4));
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
