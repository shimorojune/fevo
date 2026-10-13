/**
 * Drive the racing line in the real simulator with a scripted controller,
 * following the reference speeds scaled by f, and report the fastest f that
 * finishes all three official laps. Shows what the calibrated car can
 * actually do through the full dynamics, not just the point-mass reference.
 *
 *   pnpm --filter @fevo/calibrate validate
 */
import { readFileSync } from "node:fs";
import { SOLO_1 as R, packCarParams } from "@fevo/rules";
import * as sim from "@fevo/sim-core";
import type { TrackFile } from "@fevo/tracks";
import { POLE_TIMES_S } from "./calibrate.ts";
import { curvature, qssLap, racingLine } from "./line.ts";

/** The scripted driver tracks the line to within about a metre, so keep the line further from the edges. */
const MARGIN = Number(process.env.MARGIN ?? 2.2);
const KE = Number(process.env.KE ?? 4);
const LA = Number(process.env.LA ?? 0.3);
const RUNNING = sim.STATUS_RUNNING.value;
const FINISHED = sim.STATUS_FINISHED.value;

sim.setCarParams(packCarParams(R.car));
sim.setTiming(R.timing.agentHz, R.timing.physicsSubsteps);
sim.setLimits(R.timing.maxSteps, R.timing.stopSpeedMps, R.timing.stopSteps);
sim.setSensors(R.sensors.rayCount, R.sensors.rayLengthM, R.sensors.rayFovRad, R.sensors.speedNormMps);
sim.setSpeedLimit(0);

function drive(t: TrackFile, f: number): number[] {
  const n = t.widthLeft.length;
  const line = racingLine(t, MARGIN);
  const ref = qssLap(line, R.car).speed;
  const k = curvature(line, 5);
  // Signed curvature of the line (left positive) and its heading.
  const head = new Float64Array(n);
  const ks = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = (i + 1) % n;
    head[i] = Math.atan2(line.y[q]! - line.y[i]!, line.x[q]! - line.x[i]!);
  }
  for (let i = 0; i < n; i++) {
    let d = head[(i + 3) % n]! - head[(i - 3 + n) % n]!;
    d = ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    ks[i] = Math.sign(d) * k[i]!;
  }
  const steps: number[] = [];
  for (let seed = 0; seed < 3; seed++) {
    const s = R.seeds[seed]!;
    sim.resetAtStart(s.lateralM, s.headingRad, 0);
    let status = RUNNING;
    while (status === RUNNING) {
      const i = sim.getProgressIndex();
      const v = sim.getVx();
      const ia = (i + Math.max(4, Math.round(LA * v))) % n;
      // Error from the line: lateral (left positive) and heading.
      const ex = sim.getX() - line.x[i]!;
      const ey = sim.getY() - line.y[i]!;
      const e = -Math.sin(head[i]!) * ex + Math.cos(head[i]!) * ey;
      let he = head[ia]! - sim.getYaw();
      he = ((he + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
      const delta = he + Math.atan((-KE * e) / (v + 3)) + Math.atan(R.car.wheelbaseM * ks[ia]!);
      const vt = f * ref[(i + Math.round(0.35 * v)) % n]!;
      const throttle = Math.max(-1, Math.min(1, (vt - v) * 0.5));
      status = sim.step(-delta / R.car.maxSteerRad, throttle);
      if (process.env.TRACE && seed === 1 && sim.getGatesPassed() >= Number(process.env.TRACE) - 2)
        console.log(`i ${i} v ${(v * 3.6).toFixed(0)} vt ${(vt * 3.6).toFixed(0)} e ${e.toFixed(2)} he ${he.toFixed(3)} off ${line.offset[i]!.toFixed(2)} wl ${t.widthLeft[i]!.toFixed(1)} wr ${t.widthRight[i]!.toFixed(1)} k ${ks[ia]!.toFixed(3)} st ${(-delta / R.car.maxSteerRad).toFixed(2)} s ${status}`);
    }
    steps.push(status === FINISHED ? sim.getSteps() : -sim.getGatesPassed());
  }
  return steps;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
for (const id of Object.keys(POLE_TIMES_S)) {
  const t: TrackFile = JSON.parse(readFileSync(new URL(`../../../packages/tracks/data/${id}.track.json`, import.meta.url), "utf8"));
  sim.loadTrack(Float64Array.from(t.centerline), Float64Array.from(t.widthLeft), Float64Array.from(t.widthRight), Int32Array.from(t.gates));
  const refS = qssLap(racingLine(t, MARGIN), R.car).lapS;
  let done = false;
  for (let f = Number(process.env.F ?? 1.0); f >= 0.7 && !done; f -= 0.02) {
    const r = drive(t, f);
    if (process.env.DEBUG) console.log(id, f.toFixed(2), r);
    if (r.every((x) => x > 0)) {
      const med = [...r].sort((a, b) => a - b)[1]! / R.timing.agentHz;
      console.log(`${id}: scripted driver at ${(f * 100).toFixed(0)}% of reference speed laps in ${fmt(med)} (reference ${fmt(refS)}, pole ${fmt(POLE_TIMES_S[id]!)})`);
      done = true;
    }
  }
  if (!done) console.log(`${id}: scripted driver didn't finish at any speed down to 70%`);
}
