/**
 * Cross-language parity fixture: compile the example agents with the
 * TypeScript compiler, run their official laps in Node, and record packed
 * programs plus lap hashes, under every rules version. tests/test_parity.py
 * checks Python reproduces every hash exactly.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint, packProgram, parseAgent } from "@fevo/agent-format";
import { ALL_RULES } from "@fevo/rules";
import { runOfficialLaps } from "@fevo/sim";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const cases = [];
// The MLP also runs with a non-default setup, so the Python car-from-setup maths is checked too.
const SETUP = { wing: 0.05, aeroBalance: 0.47, antiRollBalance: -0.4, brakeBias: 0.55 };
for (const name of ["example-genome", "example-mlp", "example-mlp+setup"]) {
  const file = name.replace("+setup", "");
  const json = JSON.parse(readFileSync(join(root, "examples", `${file}.json`), "utf8"));
  const text = JSON.stringify(name.endsWith("+setup") ? { ...json, setup: SETUP } : json);
  for (const R of ALL_RULES) {
    const parsed = parseAgent(text, { inputs: 15, outputs: 2, setup: R.setup });
    if (!parsed.ok) throw new Error(parsed.errors[0]!.message);
    const p = packProgram(parsed.program);
    for (const trackId of ["spielberg", "monza", "austin"]) {
      const track = JSON.parse(readFileSync(join(root, "packages", "tracks", "data", `${trackId}.track.json`), "utf8"));
      const r = runOfficialLaps(R, track, parsed.program);
      cases.push({
        agent: name,
        rules: R.id,
        text,
        fingerprint: await fingerprint(parsed.program),
        trackId,
        program: {
          slotCount: p.slotCount,
          io: Array.from(p.io),
          nodeInts: Array.from(p.nodeInts),
          nodeFloats: Array.from(p.nodeFloats),
          linkSlots: Array.from(p.linkSlots),
          linkWeights: Array.from(p.linkWeights),
        },
        laps: r.laps.map((l) => ({ seed: l.seed, status: l.status, steps: l.steps, gatesPassed: l.gatesPassed, hash: l.hash })),
        medianSteps: r.medianSteps,
      });
    }
  }
}
mkdirSync(join(here, "..", "tests", "fixtures"), { recursive: true });
writeFileSync(join(here, "..", "tests", "fixtures", "node-laps.json"), JSON.stringify({ cases }, null, 1) + "\n");
console.log(`wrote ${cases.length} parity cases`);
