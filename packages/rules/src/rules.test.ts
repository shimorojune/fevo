import assert from "node:assert/strict";
import { test } from "node:test";
import { CAR_PARAM_ORDER, packCarParams } from "./car.ts";
import { SOLO_1, SOLO_1_CAR } from "./solo1.ts";

test("CAR_PARAM_ORDER covers every car param exactly once", () => {
  assert.deepEqual([...CAR_PARAM_ORDER].sort(), Object.keys(SOLO_1_CAR).sort());
  assert.equal(new Set(CAR_PARAM_ORDER).size, CAR_PARAM_ORDER.length);
});

test("packCarParams keeps order and values", () => {
  const packed = packCarParams(SOLO_1_CAR);
  CAR_PARAM_ORDER.forEach((key, i) => assert.equal(packed[i], SOLO_1_CAR[key]));
});

test("packCarParams rejects non-finite values", () => {
  assert.throws(() => packCarParams({ ...SOLO_1_CAR, massKg: Number.NaN }));
});

test("solo-1 geometry is physically sane", () => {
  const c = SOLO_1_CAR;
  assert.ok(c.cgToFrontM > 0 && c.cgToFrontM < c.wheelbaseM);
  assert.ok(c.wheelbaseM < c.lengthM);
  assert.ok(c.kinematicBelowMps < c.dynamicAboveMps);
  assert.equal(SOLO_1.observation.length, SOLO_1.sensors.rayCount + 4);
});

test("top speed implied by power and drag is F1-like", () => {
  const c = SOLO_1_CAR;
  // P = (½ρ·CdA·v² + Crr·m·g)·v, solved by bisection.
  const resist = (v: number) =>
    (0.5 * c.airDensityKgM3 * c.dragAreaM2 * v * v + c.rollingResistance * c.massKg * c.gravityMps2) * v;
  let lo = 0;
  let hi = 200;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (resist(mid) > c.powerW) hi = mid;
    else lo = mid;
  }
  const kmh = lo * 3.6;
  assert.ok(kmh > 320 && kmh < 370, `top speed ${kmh.toFixed(1)} km/h`);
});
