/**
 * Fit the car's grip and downforce so the reference lap on the racing line
 * matches real pole times, across all circuits at once.
 *
 *   pnpm --filter @fevo/calibrate calibrate
 *
 * Targets are 2025 qualifying pole times (approximate, from memory of the
 * published results; check before freezing a rules version). Mass, power,
 * dimensions and drag stay at their 2026-spec values; tyre grip, downforce
 * and brake force are fitted.
 */
import { readFileSync } from "node:fs";
import { SOLO_1, type CarParams } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";
import { qssLap, racingLine, type Line } from "./line.ts";

export const POLE_TIMES_S: Record<string, number> = {
  spielberg: 63.971, // 2025 Austrian GP pole
  monza: 78.792, // 2025 Italian GP pole
  austin: 92.51, // 2025 US GP pole
};

const track = (id: string): TrackFile =>
  JSON.parse(readFileSync(new URL(`../../../packages/tracks/data/${id}.track.json`, import.meta.url), "utf8"));

export function lines(car: CarParams): Record<string, Line> {
  return Object.fromEntries(Object.keys(POLE_TIMES_S).map((id) => [id, racingLine(track(id), car.widthM / 2 + 0.5)]));
}

export function score(car: CarParams, ls: Record<string, Line>) {
  const times = Object.fromEntries(Object.entries(ls).map(([id, l]) => [id, qssLap(l, car).lapS]));
  const err = Object.entries(times).reduce((a, [id, t]) => a + Math.log(t / POLE_TIMES_S[id]!) ** 2, 0);
  return { times, err };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base: CarParams = { ...SOLO_1.car };
  const ls = lines(base);
  const show = (label: string, car: CarParams) => {
    const { times, err } = score(car, ls);
    const cells = Object.entries(times).map(([id, t]) => `${id} ${t.toFixed(2)} (pole ${POLE_TIMES_S[id]!.toFixed(2)}, ${(((t - POLE_TIMES_S[id]!) / POLE_TIMES_S[id]!) * 100).toFixed(1)}%)`);
    console.log(`${label.padEnd(10)} ${cells.join("  ")}  rms ${(Math.sqrt(err / 3) * 100).toFixed(2)}%`);
  };
  show("current", base);
  // Search only physically plausible cars: slick mechanical grip up to μ 2.0,
  // a top speed of 340–360 km/h, and peak cornering no more than about 5 g at
  // 200 km/h and 6.5 g at 300 km/h (what F1 telemetry shows).
  const topSpeed = (car: CarParams) => {
    let lo = 0;
    let hi = 150;
    for (let i = 0; i < 60; i++) {
      const v = (lo + hi) / 2;
      const p = (0.5 * car.airDensityKgM3 * car.dragAreaM2 * v * v + car.rollingResistance * car.massKg * car.gravityMps2) * v;
      if (p > car.powerW) hi = v;
      else lo = v;
    }
    return lo;
  };
  const gAt = (car: CarParams, v: number) =>
    ((car.tyreMuFront + car.tyreMuRear) / 2) * (1 + (0.5 * car.airDensityKgM3 * car.downforceAreaM2 * v * v) / (car.massKg * car.gravityMps2));
  let best = { err: Infinity, car: base };
  for (let mu = 1.6; mu <= 2.0001; mu += 0.05) {
    for (let cla = 3; cla <= 7.0001; cla += 0.2) {
      for (let cda = 0.9; cda <= 1.4001; cda += 0.05) {
        const car = { ...base, tyreMuFront: mu, tyreMuRear: mu + 0.15, downforceAreaM2: cla, dragAreaM2: cda, maxBrakeForceN: 60000 };
        if (gAt(car, 200 / 3.6) > 5.0 || gAt(car, 300 / 3.6) > 6.5) continue;
        const vTop = topSpeed(car) * 3.6;
        if (vTop < 340 || vTop > 360) continue;
        const { err } = score(car, ls);
        if (err < best.err) best = { err, car };
      }
    }
  }
  show("fitted", best.car);
  console.log(`  top speed ${(topSpeed(best.car) * 3.6).toFixed(0)} km/h`);
  const c = best.car;
  for (const v of [25, 55, 83]) {
    const df = 0.5 * c.airDensityKgM3 * c.downforceAreaM2 * v * v;
    const g = ((c.tyreMuFront + c.tyreMuRear) / 2) * (1 + df / (c.massKg * c.gravityMps2));
    void gAt;
    console.log(`  peak cornering at ${(v * 3.6).toFixed(0)} km/h ≈ ${g.toFixed(1)} g`);
  }
  console.log(
    `tyreMuFront ${c.tyreMuFront.toFixed(2)}, tyreMuRear ${c.tyreMuRear.toFixed(2)}, downforceAreaM2 ${c.downforceAreaM2.toFixed(1)}, dragAreaM2 ${c.dragAreaM2.toFixed(2)}, maxBrakeForceN ${c.maxBrakeForceN}`,
  );
}
