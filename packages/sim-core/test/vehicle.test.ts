// Runs against the built wasm: pnpm --filter @fevo/sim-core build && pnpm --filter @fevo/sim-core test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { CAR_PARAM_ORDER, SOLO_1, packCarParams } from "@fevo/rules";
import * as sim from "../build/sim.js";

const G = SOLO_1.car.gravityMps2;
const HZ = SOLO_1.timing.agentHz;

before(() => {
  sim.setCarParams(packCarParams(SOLO_1.car));
  sim.setTiming(HZ, SOLO_1.timing.physicsSubsteps);
});

test("param slots match CAR_PARAM_ORDER", () => {
  const src = readFileSync(new URL("../assembly/params.ts", import.meta.url), "utf8");
  const slots = new Map([...src.matchAll(/export const (\w+): i32 = (\d+);/g)].map((m) => [m[1]!, Number(m[2])]));
  const slotFor: Record<(typeof CAR_PARAM_ORDER)[number], string> = {
    massKg: "MASS",
    lengthM: "LENGTH",
    widthM: "WIDTH",
    wheelbaseM: "WHEELBASE",
    cgToFrontM: "CG_TO_FRONT",
    cgHeightM: "CG_HEIGHT",
    yawInertiaKgM2: "YAW_INERTIA",
    maxSteerRad: "MAX_STEER",
    steerRateRadPerS: "STEER_RATE",
    powerW: "POWER",
    maxBrakeForceN: "MAX_BRAKE_FORCE",
    brakeBiasFront: "BRAKE_BIAS_FRONT",
    tyreMuFront: "TYRE_MU_FRONT",
    tyreMuRear: "TYRE_MU_REAR",
    pacejkaBFront: "PACEJKA_B_FRONT",
    pacejkaBRear: "PACEJKA_B_REAR",
    pacejkaC: "PACEJKA_C",
    pacejkaE: "PACEJKA_E",
    dragAreaM2: "DRAG_AREA",
    downforceAreaM2: "DOWNFORCE_AREA",
    aeroBalanceFront: "AERO_BALANCE_FRONT",
    airDensityKgM3: "AIR_DENSITY",
    rollingResistance: "ROLLING_RESISTANCE",
    gravityMps2: "GRAVITY",
    kinematicBelowMps: "KINEMATIC_BELOW",
    dynamicAboveMps: "DYNAMIC_ABOVE",
  };
  assert.equal(slots.get("PARAM_COUNT"), CAR_PARAM_ORDER.length);
  CAR_PARAM_ORDER.forEach((key, i) => assert.equal(slots.get(slotFor[key]), i, key));
});

test("standing start: 0-100 km/h and top speed are F1-like", () => {
  sim.reset(0, 0, 0, 0);
  let t100 = -1;
  for (let i = 0; i < 40 * HZ; i++) {
    sim.step(0, 1);
    if (t100 < 0 && sim.getVx() * 3.6 >= 100) t100 = (i + 1) / HZ;
  }
  const top = sim.getVx() * 3.6;
  assert.ok(t100 > 2 && t100 < 3.5, `0-100 in ${t100}s`);
  assert.ok(top > 320 && top < 370, `top ${top.toFixed(1)} km/h`);
  assert.ok(Math.abs(sim.getY()) < 1e-9, "straight line stays straight");
});

test("braking from 300 km/h stops in a plausible distance", () => {
  sim.reset(0, 0, 0, 300 / 3.6);
  let steps = 0;
  while (sim.getVx() > 0 && steps < 20 * HZ) {
    sim.step(0, -1);
    steps++;
  }
  const d = sim.getX();
  assert.ok(d > 80 && d < 200, `stopped in ${d.toFixed(1)} m, ${(steps / HZ).toFixed(2)} s`);
});

test("steady cornering at 200 km/h is F1-like and stable", () => {
  const v = 55;
  sim.reset(0, 0, 0, v);
  const yawRates: number[] = [];
  for (let i = 0; i < 10 * HZ; i++) {
    const throttle = Math.max(-1, Math.min(1, (v - sim.getVx()) * 2));
    sim.step(0.1, throttle);
    if (i >= 8 * HZ) yawRates.push(sim.getYawRate());
  }
  const mean = yawRates.reduce((a, b) => a + b) / yawRates.length;
  const latG = Math.abs(sim.getVx() * mean) / G;
  assert.ok(latG > 1.5 && latG < 4.5, `lateral ${latG.toFixed(2)} g`);
  for (const r of yawRates) assert.ok(Math.abs(r - mean) < 0.01 * Math.abs(mean), "yaw rate settles");
});

test("same inputs give a bit-identical state", () => {
  const script = () => {
    sim.reset(10, -5, 0.3, 0);
    for (let i = 0; i < 20 * HZ; i++) sim.step(Math.sin(i / 37), i % 300 < 200 ? 1 : -0.6);
    return sim.stateHash();
  };
  assert.equal(script(), script());
});

test("non-finite inputs end the lap with an error", () => {
  sim.reset(0, 0, 0, 10);
  assert.equal(sim.step(Number.NaN, 0), sim.STATUS_ERROR.value);
  assert.equal(sim.step(0, Number.POSITIVE_INFINITY), sim.STATUS_ERROR.value);
});

test("full brakes at 100 km/h lock the fronts and lose the steering; threshold braking keeps it", () => {
  const stop = (pedal: number, steer = 0) => {
    sim.reset(0, 0, 0, 100 / 3.6);
    let locked = 0;
    let turned = 0;
    while (sim.getVx() > 1) {
      sim.step(steer, -pedal);
      locked = Math.max(locked, sim.getFrontSlide());
      turned = Math.max(turned, Math.abs(sim.getYaw()));
    }
    return { d: sim.getX(), locked, turned };
  };
  // The hardest pedal that doesn't lock anything.
  let best = 0;
  for (let p = 0.05; p <= 1.0001; p += 0.01) if (stop(p).locked === 0) best = p;
  const full = stop(1);
  const threshold = stop(best);
  assert.ok(full.locked > 0 && best > 0.1 && best < 0.9, `threshold pedal ${best.toFixed(2)}`);
  assert.ok(full.d > threshold.d * 0.95, `locked ${full.d.toFixed(1)} m vs threshold ${threshold.d.toFixed(1)} m`);
  assert.ok(stop(1, 1).turned < 0.5 * stop(best, 1).turned, "locked fronts barely steer");
});

test("full throttle from a standstill spins the rears", () => {
  sim.reset(0, 0, 0, 0);
  let spin = 0;
  for (let i = 0; i < 60; i++) {
    sim.step(0, 1);
    spin = Math.max(spin, sim.getRearSlide());
  }
  assert.ok(spin > 0);
});
