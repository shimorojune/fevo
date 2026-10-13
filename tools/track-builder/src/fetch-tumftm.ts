/**
 * Download the TUMFTM CSVs for every circuit in CIRCUIT_SOURCES into
 * data/tumftm/. The files are committed so bakes are reproducible offline.
 * Source: TUMFTM/racetrack-database, LGPL-3.0.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCUIT_SOURCES, TUMFTM_BASE_URL } from "./circuits.ts";
import { parseTumftmCsv } from "./geometry.ts";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "tumftm");
mkdirSync(dir, { recursive: true });

for (const src of Object.values(CIRCUIT_SOURCES)) {
  const url = `${TUMFTM_BASE_URL}/${src.tumftmFile}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  const points = parseTumftmCsv(text).length;
  writeFileSync(join(dir, src.tumftmFile), text);
  console.log(`${src.tumftmFile}: ${points} points`);
}
