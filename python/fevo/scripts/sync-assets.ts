/**
 * Copy everything the Python SDK needs from the TypeScript build into
 * src/fevo/_data: the exact sim.wasm, the baked tracks, the rules as JSON,
 * branding and the replay viewer. The Python side never re-implements any of it.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCUITS, TEAMS } from "@fevo/branding";
import { CAR_PARAM_ORDER, SOLO_1, packCarParams } from "@fevo/rules";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "fevo", "_data");
const deps = join(here, "..", "node_modules", "@fevo");
const wasmPath = join(deps, "sim-core", "build", "sim.wasm");
const tracksDir = join(deps, "tracks", "data");
const viewer = join(here, "..", "..", "..", "tools", "replay", "src", "viewer.html");

mkdirSync(join(out, "tracks"), { recursive: true });
mkdirSync(join(out, "rules"), { recursive: true });

copyFileSync(wasmPath, join(out, "sim.wasm"));
const wasmSha = createHash("sha256").update(readFileSync(wasmPath)).digest("hex");

const tracks: Record<string, string> = {};
for (const f of readdirSync(tracksDir).filter((f) => f.endsWith(".track.json"))) {
  copyFileSync(join(tracksDir, f), join(out, "tracks", f));
  tracks[f.replace(".track.json", "")] = JSON.parse(readFileSync(join(tracksDir, f), "utf8")).sha256;
}

const rules = { ...SOLO_1, carParamOrder: CAR_PARAM_ORDER, carParamsPacked: Array.from(packCarParams(SOLO_1.car)) };
writeFileSync(join(out, "rules", `${SOLO_1.id}.json`), JSON.stringify(rules, null, 1) + "\n");
writeFileSync(join(out, "branding.json"), JSON.stringify({ teams: TEAMS, circuits: CIRCUITS }, null, 1) + "\n");
copyFileSync(viewer, join(out, "viewer.html"));

const manifest = { simVersion: SOLO_1.simVersion, rules: [SOLO_1.id], wasmSha256: wasmSha, tracks };
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`synced sim.wasm ${wasmSha.slice(0, 12)}, ${Object.keys(tracks).length} tracks, rules ${SOLO_1.id}`);
