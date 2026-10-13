// Scratch: reference laps with the current car on centre line vs racing line.
import { readFileSync } from "node:fs";
import { SOLO_1 } from "@fevo/rules";
import { centreLine, qssLap, racingLine } from "./line.ts";
for (const id of ["spielberg", "monza", "austin"]) {
  const t = JSON.parse(readFileSync(new URL(`../../../packages/tracks/data/${id}.track.json`, import.meta.url), "utf8"));
  const c = qssLap(centreLine(t), SOLO_1.car);
  const t0 = performance.now();
  const line = racingLine(t, SOLO_1.car.widthM / 2 + 0.5);
  const r = qssLap(line, SOLO_1.car);
  const len = Array.from(line.x).reduce((a, _, i, xs) => a + Math.hypot(line.x[(i + 1) % xs.length]! - line.x[i]!, line.y[(i + 1) % xs.length]! - line.y[i]!), 0);
  console.log(id, "centre", c.lapS.toFixed(2), "racing", r.lapS.toFixed(2), "line len", len.toFixed(0), "min v", (Math.min(...r.speed) * 3.6).toFixed(0), `${(performance.now() - t0).toFixed(0)} ms`);
}
