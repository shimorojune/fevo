/**
 * The simulator as the rest of the platform uses it: one API for the browser
 * (Web Worker), the Node verifier and tests. All physics, sensing and network
 * evaluation run inside @fevo/sim-core's wasm.
 */
import { packProgram, type Program } from "@fevo/agent-format";
import { applySetup, lowSpeedCode, observationSetCode, packCarParams, rearSlideArgs, trackLimitsCode, type Rules } from "@fevo/rules";
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
  /** Front lock-up intensity per step, 0 (gripping) to 1. */
  frontSlide: Float64Array;
  /** Rear lock-up (when braking) or wheelspin (on throttle) per step, 0 to 1. */
  rearSlide: Float64Array;
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

/** The car for a setup given as values in the rules' knob order (a Program's `setup`). */
export function carFor(rules: Rules, setup?: readonly number[]) {
  const s = setup ? Object.fromEntries(rules.setup.map((k, i) => [k.id, setup[i]!])) : undefined;
  return applySetup(rules.car, rules.setup, s);
}

/** Configure the wasm for a rules version and car setup (default setup if omitted). */
export function configure(rules: Rules, setup?: readonly number[]): void {
  core.setCarParams(packCarParams(carFor(rules, setup)));
  // Always set: the wasm keeps the model between configures, and solo-1 (no `tyres`) needs drive-only back.
  core.setRearSlideModel(...rearSlideArgs(rules.tyres));
  core.setTrackLimits(trackLimitsCode(rules.trackLimits));
  core.setLowSpeedModel(lowSpeedCode(rules.lowSpeed));
  core.setObservationSet(observationSetCode(rules.observation, rules.sensors.rayCount));
  core.setTiming(rules.timing.agentHz, rules.timing.physicsSubsteps);
  core.setLimits(rules.timing.maxSteps, rules.timing.stopSpeedMps, rules.timing.stopSteps);
  core.setSensors(rules.sensors.rayCount, rules.sensors.rayLengthM, rules.sensors.rayFovRad, rules.sensors.speedNormMps);
  core.setSpeedLimit(0); // practice knob off: official laps have no limit
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
      frontSlide: new Float64Array(cap),
      rearSlide: new Float64Array(cap),
    };
    const record = (i: number) => {
      t.x[i] = core.getX();
      t.y[i] = core.getY();
      t.yaw[i] = core.getYaw();
      t.speed[i] = core.getVx();
      t.steer[i] = core.getAgentSteer();
      t.throttle[i] = core.getAgentThrottle();
      t.gates[i] = core.getGatesPassed();
      t.frontSlide[i] = core.getFrontSlide();
      t.rearSlide[i] = core.getRearSlide();
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
      frontSlide: t.frontSlide.slice(0, n),
      rearSlide: t.rearSlide.slice(0, n),
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
  configure(rules, program.setup);
  loadTrack(track);
  loadAgent(program);
  const laps = rules.seeds.map((_, i) => ({ ...runLap(rules, i), gateCount: track.gates.length }));
  return summarizeOfficial(laps);
}

/**
 * Ranking rule from the rules page: the median of three laps, where an
 * unfinished lap counts as slower than any finished one. With unfinished
 * laps as +infinity, the median is the second-fastest finished lap, so two
 * finished laps are needed to be ranked.
 */
export function summarizeOfficial(laps: LapResult[]): OfficialResult {
  const finished = laps.filter((l) => l.status === "finished").map((l) => l.steps).sort((a, b) => a - b);
  const ranked = finished.length >= 2;
  return { laps, medianSteps: ranked ? finished[1]! : null, ranked };
}

/** Steps to "m:ss.hh" at the rules' agent rate. */
export function formatLapTime(steps: number, agentHz: number): string {
  const centis = Math.round((steps / agentHz) * 100);
  const m = Math.floor(centis / 6000);
  const s = ((centis % 6000) / 100).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}
