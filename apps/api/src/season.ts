/**
 * What the leaderboard ranks: one rules version, its circuits, and the exact
 * sim.wasm build. A season never changes once published; a new rules version
 * means a new season and a new board.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CIRCUITS } from "@fevo/branding";
import { CURRENT_RULES, type Rules } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";

export const RULES: Rules = CURRENT_RULES;

export const CIRCUIT_IDS: readonly string[] = CIRCUITS.map((c) => c.id);

const tracks = new Map<string, TrackFile>();

/** The baked track for a circuit, or undefined if the season doesn't race there. */
export function trackFor(circuitId: string): TrackFile | undefined {
  if (!CIRCUIT_IDS.includes(circuitId)) return undefined;
  let t = tracks.get(circuitId);
  if (!t) {
    t = JSON.parse(readFileSync(new URL(import.meta.resolve(`@fevo/tracks/data/${circuitId}.track.json`)), "utf8")) as TrackFile;
    tracks.set(circuitId, t);
  }
  return t;
}

/** SHA-256 of the sim.wasm this server verifies with, stored on every verified lap. */
export const SIM_WASM_SHA256 = createHash("sha256")
  .update(readFileSync(new URL(import.meta.resolve("@fevo/sim-core/sim.wasm"))))
  .digest("hex");

export const agentShape = () => ({ inputs: RULES.observation.length, outputs: RULES.action.length, setup: RULES.setup });
