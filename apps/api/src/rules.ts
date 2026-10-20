/**
 * The rules versions and the sim.wasm build this server runs. A model names
 * the rules it was trained under; the server only re-runs laps for rules it
 * knows, on its own sim.wasm, whose hash is stored with every lap.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { circuitBrand, CIRCUITS } from "@fevo/branding";
import { CURRENT_RULES, SOLO_1, type Rules } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";

/** Every rules version the server can run, by id. Add new versions here, never edit old ones. */
export const RULES_BY_ID: ReadonlyMap<string, Rules> = new Map([SOLO_1].map((r) => [r.id, r]));

export const DEFAULT_RULES: Rules = CURRENT_RULES;

/** SHA-256 of the sim.wasm this server runs laps with. */
export const SIM_WASM_SHA256 = createHash("sha256")
  .update(readFileSync(new URL(import.meta.resolve("@fevo/sim-core/sim.wasm"))))
  .digest("hex");

export const agentShape = (rules: Rules) => ({ inputs: rules.observation.length, outputs: rules.action.length, setup: rules.setup });

/** The tracks baked into @fevo/tracks, seeded into an empty database on startup. */
export function bakedTracks(): { id: string; name: string; data: TrackFile }[] {
  return CIRCUITS.map((c) => ({
    id: c.id,
    name: circuitBrand(c.id).name,
    data: JSON.parse(readFileSync(new URL(import.meta.resolve(`@fevo/tracks/data/${c.id}.track.json`)), "utf8")) as TrackFile,
  }));
}
