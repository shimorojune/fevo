/**
 * Bake one circuit from its TUMFTM CSV.
 *   node src/cli.ts spielberg [--revision 1] [--spacing 1] [--tolerance 0.01]
 * Reads data/tumftm/<file>.csv, writes packages/tracks/data/<id>.track.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bakeTrack } from "./bake.ts";
import { CIRCUIT_SOURCES, TUMFTM_BASE_URL, TUMFTM_LICENSE } from "./circuits.ts";
import { parseTumftmCsv } from "./geometry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "..", "..", "packages", "tracks", "data");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    revision: { type: "string", default: "1" },
    spacing: { type: "string", default: "1" },
    "gate-spacing": { type: "string", default: "40" },
    tolerance: { type: "string", default: "0.01" },
  },
});

const id = positionals[0];
const src = id ? CIRCUIT_SOURCES[id] : undefined;
if (!src) {
  console.error(`usage: bake <${Object.keys(CIRCUIT_SOURCES).join("|")}>`);
  process.exit(2);
}

const csvPath = join(root, "data", "tumftm", src.tumftmFile);
const raw = parseTumftmCsv(readFileSync(csvPath, "utf8"));
const { file, report } = bakeTrack(raw, {
  circuitId: src.id,
  revision: Number(values.revision),
  source: { kind: "tumftm", file: src.tumftmFile, url: `${TUMFTM_BASE_URL}/${src.tumftmFile}`, license: TUMFTM_LICENSE },
  officialLengthM: src.officialLengthM,
  startIndex: src.startIndex,
  spacingM: Number(values.spacing),
  gateSpacingM: Number(values["gate-spacing"]),
  lengthTolerance: Number(values.tolerance),
});

console.log(JSON.stringify({ circuit: src.id, ...report, foldedSamples: report.foldedSamples.length }, null, 2));
if (report.errors.length > 0) {
  console.error(`not written: ${report.errors.join("; ")}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${src.id}.track.json`);
writeFileSync(outPath, JSON.stringify(file) + "\n");
console.log(`wrote ${outPath} (sha256 ${file.sha256.slice(0, 12)})`);
