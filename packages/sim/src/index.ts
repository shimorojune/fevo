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

/**
 * Driver error: a slowly drifting error added to the agent's steering and pedal, the same
 * kind the trainer practises with (fevo-racer1 robust_check): each step
 * drift = 0.9 · drift + N(0, level · 0.436), applied = clamp(output + drift). Seeded, so a lap
 * with error replays identically; it is not bit-identical to the numpy runs in Python.
 */
export interface DriverError {
  /** 0 to 1; 0.03, 0.06 and 0.1 are the levels the dashboard offers. */
  level: number;
  /** Noise stream; the same seed gives the same lap. */
  noiseSeed: number;
}

/** mulberry32: a small, fast, seeded PRNG giving floats in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A drifting error source: next() returns the [steer, throttle] offsets for one step. */
export function driftingError({ level, noiseSeed }: DriverError) {
  const u = rng(noiseSeed);
  const sigma = level * 0.436;
  const gauss = () => {
    // Box–Muller; 1 - u() keeps the log away from 0.
    const r = Math.sqrt(-2 * Math.log(1 - u()));
    return r * Math.cos(2 * Math.PI * u());
  };
  const d = [0, 0];
  return {
    next(): [number, number] {
      d[0] = 0.9 * d[0]! + sigma * gauss();
      d[1] = 0.9 * d[1]! + sigma * gauss();
      return [d[0]!, d[1]!];
    },
  };
}

/** Run one lap of the loaded agent on the loaded track from a published seed. */
export function runLap(rules: Rules, seed: number, opts: { trace?: boolean; error?: DriverError } = {}): LapResult {
  const nudge = rules.seeds[seed];
  if (!nudge) throw new Error(`no seed ${seed} in rules ${rules.id}`);
  core.resetAtStart(nudge.lateralM, nudge.headingRad, rules.start.initialSpeedMps);
  // With driver error the host drives each step: read the observation, evaluate the agent,
  // add the drift, step. Without it the wasm drives itself, as it always has.
  const err = opts.error && opts.error.level > 0 ? driftingError(opts.error) : null;
  const obs = err ? new Float64Array(core.getObservationCount()) : null;
  let applied: [number, number] = [0, 0];
  const advance = (): number => {
    if (!err || !obs) return core.agentStep();
    for (let i = 0; i < obs.length; i++) obs[i] = core.getObservation(i);
    core.evaluateAgent(obs);
    const [ds, dt] = err.next();
    applied = [Math.max(-1, Math.min(1, core.getAgentSteer() + ds)), Math.max(-1, Math.min(1, core.getAgentThrottle() + dt))];
    return core.step(applied[0], applied[1]);
  };
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
      t.steer[i] = err ? applied[0] : core.getAgentSteer();
      t.throttle[i] = err ? applied[1] : core.getAgentThrottle();
      t.gates[i] = core.getGatesPassed();
      t.frontSlide[i] = core.getFrontSlide();
      t.rearSlide[i] = core.getRearSlide();
    };
    record(0);
    do {
      status = advance();
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
  } else if (err) {
    do status = advance();
    while (status === core.STATUS_RUNNING.value);
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
