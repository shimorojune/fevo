/**
 * Does the full vehicle model corner as hard as the reference lap assumes?
 * Holds constant speed on a steady circle, sweeps steering, and reports the
 * highest stable lateral acceleration at a few speeds next to the
 * point-mass figure the reference uses.
 *
 *   node src/check-grip.ts
 */
import { SOLO_1 as R, packCarParams } from "@fevo/rules";
import * as sim from "@fevo/sim-core";

const c = R.car;
sim.setCarParams(packCarParams(c));
sim.setTiming(R.timing.agentHz, R.timing.physicsSubsteps);
sim.setLimits(1_000_000, -1, 1_000_000);
sim.setSpeedLimit(0);
const G = c.gravityMps2;
for (const kmh of [90, 150, 200, 250, 300]) {
  const v = kmh / 3.6;
  let best = 0;
  for (let st = 0.01; st <= 1.0; st += 0.01) {
    sim.reset(0, 0, 0, v);
    const rs: number[] = [];
    for (let i = 0; i < 8 * 60; i++) {
      sim.step(st, Math.max(-1, Math.min(1, (v - sim.getVx()) * 2)));
      if (i >= 6 * 60) rs.push(sim.getYawRate());
    }
    const mean = rs.reduce((a, b) => a + b) / rs.length;
    const stable = rs.every((r) => Math.abs(r - mean) < 0.01 * Math.abs(mean) + 1e-4) && Math.abs(sim.getVx() - v) < 1.5;
    if (stable) best = Math.max(best, Math.abs(sim.getVx() * mean) / G);
  }
  const df = 0.5 * c.airDensityKgM3 * c.downforceAreaM2 * v * v;
  const qss = ((c.tyreMuFront + c.tyreMuRear) / 2) * (1 + df / (c.massKg * G));
  console.log(`${kmh} km/h: vehicle model ${best.toFixed(2)} g, reference assumes ${qss.toFixed(2)} g`);
}
