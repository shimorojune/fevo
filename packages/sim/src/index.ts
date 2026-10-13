/**
 * The simulator as the rest of the platform uses it: one API for the browser
 * (Web Worker), the Node verifier and tests. All physics, sensing and network
 * evaluation run inside @fevo/sim-core's wasm.
 */
import { packProgram, type Program } from "@fevo/agent-format";
import { packCarParams, type Rules } from "@fevo/rules";
import * as core from "@fevo/sim-core";
import type { TrackFile } from "@fevo/tracks";

export const LAP_STATUS = ["running", "finished", "crashed", "stopped", "error", "timed-out"] as const;
export type LapStatus = (typeof LAP_STATUS)[number];

export interface LapTrace {
  x: Float64Array;
  y: Float64Array;
  yaw: Float64Array;
  speed: Float64Array;
  steer: Float64Array;
  throttle: Float64Array;
  gates: Int32Array;
}

export interface LapResult {
  seed: number;
  status: LapStatus;
  steps: number;
  gatesPassed: number;
  gateCount: number;
  /** Sim state hash at the end of the lap; equal hashes mean identical laps. */
  hash: string;
  trace?: LapTrace;
}

export interface OfficialResult {
  laps: LapResult[];
  /** Median steps over the three seeds; unfinished laps count as slower than any finished one. */
  medianSteps: number | null;
  ranked: boolean;
}

/** Configure the wasm for a rules version. Call once per rules version. */
export function configure(rules: Rules): void {
  core.setCarParams(packCarParams(rules.car));
  core.setTiming(rules.timing.agentHz, rules.timing.physicsSubsteps);
  core.setLimits(rules.timing.maxSteps, rules.timing.stopSpeedMps, rules.timing.stopSteps);
  core.setSensors(rules.sensors.rayCount, rules.sensors.rayLengthM, rules.sensors.rayFovRad, rules.sensors.speedNormMps);
}

export function loadTrack(track: TrackFile): void {
  core.loadTrack(
    Float64Array.from(track.centerline),
    Float64Array.from(track.widthLeft),
    Float64Array.from(track.widthRight),
    Int32Array.from(track.gates),
  );
}

export function loadAgent(program: Program): void {
  const p = packProgram(program);
  core.loadAgent(p.slotCount, p.io, p.nodeInts, p.nodeFloats, p.linkSlots, p.linkWeights);
}

/** Run one lap of the loaded agent on the loaded track from a published seed. */
export function runLap(rules: Rules, seed: number, opts: { trace?: boolean } = {}): LapResult {
  const nudge = rules.seeds[seed];
  if (!nudge) throw new Error(`no seed ${seed} in rules ${rules.id}`);
  core.resetAtStart(nudge.lateralM, nudge.headingRad, rules.start.initialSpeedMps);
  let status: number;
  let trace: LapTrace | undefined;
  if (opts.trace) {
    const cap = rules.timing.maxSteps + 1;
    const t = {
      x: new Float64Array(cap),
      y: new Float64Array(cap),
      yaw: new Float64Array(cap),
      speed: new Float64Array(cap),
      steer: new Float64Array(cap),
      throttle: new Float64Array(cap),
      gates: new Int32Array(cap),
    };
    const record = (i: number) => {
      t.x[i] = core.getX();
      t.y[i] = core.getY();
      t.yaw[i] = core.getYaw();
      t.speed[i] = core.getVx();
      t.steer[i] = core.getAgentSteer();
      t.throttle[i] = core.getAgentThrottle();
      t.gates[i] = core.getGatesPassed();
    };
    record(0);
    do {
      status = core.agentStep();
      record(core.getSteps());
    } while (status === core.STATUS_RUNNING.value);
    const n = core.getSteps() + 1;
    trace = {
      x: t.x.slice(0, n),
      y: t.y.slice(0, n),
      yaw: t.yaw.slice(0, n),
      speed: t.speed.slice(0, n),
      steer: t.steer.slice(0, n),
      throttle: t.throttle.slice(0, n),
      gates: t.gates.slice(0, n),
    };
  } else {
    status = core.runAgentLap();
  }
  const result: LapResult = {
    seed,
    status: LAP_STATUS[status] ?? "error",
    steps: core.getSteps(),
    gatesPassed: core.getGatesPassed(),
    gateCount: 0,
    hash: core.stateHash().toString(16).padStart(16, "0"),
  };
  if (trace) result.trace = trace;
  return result;
}

/** The three official laps and the ranking rule from the rules page. */
export function runOfficialLaps(rules: Rules, track: TrackFile, program: Program): OfficialResult {
  configure(rules);
  loadTrack(track);
  loadAgent(program);
  const laps = rules.seeds.map((_, i) => ({ ...runLap(rules, i), gateCount: track.gates.length }));
  const finished = laps.filter((l) => l.status === "finished").map((l) => l.steps).sort((a, b) => a - b);
  const ranked = finished.length >= 2;
  // Median of three with unfinished laps as +infinity: the middle value is the
  // second-fastest finished lap when at least two finished.
  const medianSteps = ranked ? finished[1]! : null;
  return { laps, medianSteps, ranked };
}

/** Steps to "m:ss.hh" at the rules' agent rate. */
export function formatLapTime(steps: number, agentHz: number): string {
  const centis = Math.round((steps / agentHz) * 100);
  const m = Math.floor(centis / 6000);
  const s = ((centis % 6000) / 100).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}
