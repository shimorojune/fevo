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

import { applySetup, completeSetup, validateSetup } from "./setup.ts";
import { SOLO_1_SETUP } from "./solo1.ts";

test("default setup is the base car", () => {
  assert.deepEqual(applySetup(SOLO_1_CAR, SOLO_1_SETUP, undefined), { ...SOLO_1_CAR });
  assert.deepEqual(applySetup(SOLO_1_CAR, SOLO_1_SETUP, { wing: 0.3 }), { ...SOLO_1_CAR });
});

test("knob defaults are inside their ranges and effects hit real params", () => {
  for (const k of SOLO_1_SETUP) {
    assert.ok(k.min <= k.default && k.default <= k.max, k.id);
    for (const e of k.effects) assert.ok(e.param in SOLO_1_CAR, `${k.id} → ${e.param}`);
  }
});

test("wing trades top speed for downforce within F1-like limits", () => {
  const top = (cda: number, c = SOLO_1_CAR) => {
    let lo = 0;
    let hi = 200;
    for (let i = 0; i < 80; i++) {
      const v = (lo + hi) / 2;
      if ((0.5 * c.airDensityKgM3 * cda * v * v + c.rollingResistance * c.massKg * c.gravityMps2) * v > c.powerW) hi = v;
      else lo = v;
    }
    return lo * 3.6;
  };
  const low = applySetup(SOLO_1_CAR, SOLO_1_SETUP, { wing: 0 });
  const high = applySetup(SOLO_1_CAR, SOLO_1_SETUP, { wing: 1 });
  assert.ok(low.downforceAreaM2 < SOLO_1_CAR.downforceAreaM2 && high.downforceAreaM2 > SOLO_1_CAR.downforceAreaM2);
  const tl = top(low.dragAreaM2);
  const th = top(high.dragAreaM2);
  assert.ok(tl > 355 && tl < 380, `low wing ${tl.toFixed(0)} km/h`);
  assert.ok(th > 315 && th < 345, `high wing ${th.toFixed(0)} km/h`);
});

test("setup validation explains problems", () => {
  assert.deepEqual(validateSetup(SOLO_1_SETUP, { wing: 0.5, brakeBias: 0.6 }), []);
  assert.match(validateSetup(SOLO_1_SETUP, { wing: 2 })[0]!, /between 0 and 1/);
  assert.match(validateSetup(SOLO_1_SETUP, { gears: 7 })[0]!, /Unknown setup "gears"/);
  assert.deepEqual(completeSetup(SOLO_1_SETUP, { wing: 0.5 }), [0.5, 0.45, 0, 0.58]);
});

import { ALL_RULES, rulesById } from "./index.ts";
import { SOLO_2 } from "./solo2.ts";
import { DEFAULT_TYRES, rearSlideArgs } from "./tyres.ts";

test("solo-2 is solo-1 plus power oversteer, and solo-1 has no tyres block", () => {
  const { id, simVersion, tyres, ...rest } = SOLO_2;
  assert.deepEqual(rest, (({ id: _i, simVersion: _s, ...r }) => r)(SOLO_1));
  assert.equal(id, "solo-2");
  assert.equal(simVersion, "1.1.0");
  assert.deepEqual(tyres, { rearSlide: "combined-slip", rearSlideMu: 0.9 });
  assert.ok(!("tyres" in SOLO_1));
});

test("tyres map to the simulator's rear slide model codes", () => {
  assert.deepEqual(rearSlideArgs(), [0, 1]);
  assert.deepEqual(rearSlideArgs(DEFAULT_TYRES), [0, 1]);
  assert.deepEqual(rearSlideArgs(SOLO_2.tyres), [1, 0.9]);
  assert.throws(() => rearSlideArgs({ rearSlide: "combined-slip", rearSlideMu: 0 }));
  assert.throws(() => rearSlideArgs({ rearSlide: "wet" as never, rearSlideMu: 0.9 }));
});

test("rules versions are listed once, oldest first, and found by id", () => {
  assert.deepEqual(
    ALL_RULES.map((r) => r.id),
    ["solo-1", "solo-2", "solo-3", "solo-4"],
  );
  assert.equal(rulesById("solo-2"), SOLO_2);
  assert.throws(() => rulesById("solo-9"), /unknown rules/);
});

import { SOLO_3 } from "./solo3.ts";
import { trackLimitsCode } from "./limits.ts";

test("solo-3 is solo-2 with the one-tyre track limit; earlier versions keep all four corners in", () => {
  const { id, simVersion, trackLimits, ...rest } = SOLO_3;
  assert.deepEqual(rest, (({ id: _i, simVersion: _s, ...r }) => r)(SOLO_2));
  assert.equal(id, "solo-3");
  assert.equal(simVersion, "1.2.0");
  assert.equal(trackLimits, "one-tyre");
  assert.ok(!("trackLimits" in SOLO_1) && !("trackLimits" in SOLO_2));
  assert.equal(trackLimitsCode(), 0);
  assert.equal(trackLimitsCode("one-tyre"), 1);
  assert.throws(() => trackLimitsCode("none" as never));
});

import { SOLO_4 } from "./solo4.ts";
import { EXTENDED_OBSERVATION, observationSetCode } from "./observation.ts";

test("solo-4 is solo-3 with the extended observation (33 inputs)", () => {
  const { id, simVersion, observation, ...rest } = SOLO_4;
  assert.deepEqual(rest, (({ id: _i, simVersion: _s, observation: _o, ...r }) => r)(SOLO_3));
  assert.equal(id, "solo-4");
  assert.equal(simVersion, "1.3.0");
  assert.deepEqual(observation, [...SOLO_3.observation, ...EXTENDED_OBSERVATION]);
  assert.equal(observation.length, 33);
  for (const r of [SOLO_1, SOLO_2, SOLO_3]) assert.equal(observationSetCode(r.observation, r.sensors.rayCount), 0);
  assert.equal(observationSetCode(SOLO_4.observation, SOLO_4.sensors.rayCount), 1);
  assert.throws(() => observationSetCode([...SOLO_3.observation, "lap_count"], 11));
});
