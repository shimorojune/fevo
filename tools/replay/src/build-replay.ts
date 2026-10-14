/**
 * Run agents on every circuit and write a self-contained replay page.
 *
 *   pnpm --filter @fevo/replay-viewer replay                       # the two example agents
 *   pnpm --filter @fevo/replay-viewer replay -- path/to/agent.json  # your own agent(s)
 *
 * Writes tools/replay/out/replay.html; open it in any browser.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseAgent } from "@fevo/agent-format";
import { CIRCUITS, TEAMS, circuitBrand } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";
import { configure, formatLapTime, loadAgent, loadTrack, runLap, runOfficialLaps } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";

const root = new URL("../../../", import.meta.url);
const outDir = new URL("../out/", import.meta.url);

const args = process.argv.slice(2).filter((a) => a !== "--");
const agentPaths = args.length
  ? args.map((p) => resolve(process.env.INIT_CWD ?? process.cwd(), p))
  : ["example-genome.json", "example-mlp.json"].map((f) => new URL(`examples/${f}`, root).pathname);

const trackDir = new URL("packages/tracks/data/", root);
const tracks: TrackFile[] = readdirSync(trackDir)
  .filter((f) => f.endsWith(".track.json"))
  .map((f) => JSON.parse(readFileSync(new URL(f, trackDir), "utf8")) as TrackFile)
  .sort((a, b) => CIRCUITS.findIndex((c) => c.id === a.circuitId) - CIRCUITS.findIndex((c) => c.id === b.circuitId));

const round = (a: Float64Array, k: number) => Array.from(a, (v) => Math.round(v * k) / k);

configure(R);
const laps = [];
for (const [ai, path] of agentPaths.entries()) {
  const parsed = parseAgent(readFileSync(path, "utf8"), { inputs: 15, outputs: 2, setup: R.setup });
  if (!parsed.ok) {
    console.error(`${basename(path)}: ${parsed.errors.map((e) => e.message).join("; ")}`);
    process.exit(1);
  }
  const team = TEAMS[ai % TEAMS.length]!;
  for (const t of tracks) {
    const official = runOfficialLaps(R, t, parsed.program);
    // Replay the median lap (or the middle seed if the agent isn't ranked).
    const finished = official.laps.filter((l) => l.status === "finished").sort((a, b) => a.steps - b.steps);
    const seed = official.ranked ? finished[1]!.seed : 1;
    configure(R, parsed.program.setup);
    loadTrack(t);
    loadAgent(parsed.program);
    const lap = runLap(R, seed, { trace: true });
    const tr = lap.trace!;
    laps.push({
      agent: basename(path),
      circuitId: t.circuitId,
      team: { name: team.real.name, colors: team.real.colors },
      seed,
      status: lap.status,
      steps: lap.steps,
      gatesPassed: lap.gatesPassed,
      official: official.laps.map((l) => ({ seed: l.seed, status: l.status, steps: l.steps })),
      medianSteps: official.medianSteps,
      x: round(tr.x, 100),
      y: round(tr.y, 100),
      yaw: round(tr.yaw, 10000),
      speed: round(tr.speed, 100),
      steer: round(tr.steer, 1000),
      throttle: round(tr.throttle, 1000),
      gates: Array.from(tr.gates),
      frontSlide: round(tr.frontSlide, 100),
      rearSlide: round(tr.rearSlide, 100),
    });
    console.log(
      `${basename(path)} @ ${t.circuitId}: ${official.ranked ? formatLapTime(official.medianSteps!, R.timing.agentHz) : "not ranked"} ` +
        `(${official.laps.map((l) => l.status).join(", ")})`,
    );
  }
}

const data = {
  rules: { id: R.id, agentHz: R.timing.agentHz, car: { length: R.car.lengthM, width: R.car.widthM } },
  tracks: tracks.map((t) => ({
    id: t.circuitId,
    name: circuitBrand(t.circuitId).name,
    location: circuitBrand(t.circuitId).location,
    lengthM: t.lengthM,
    centerline: t.centerline,
    widthLeft: t.widthLeft,
    widthRight: t.widthRight,
    gates: t.gates,
  })),
  laps,
};

const template = readFileSync(new URL("viewer.html", import.meta.url), "utf8");
const html = template.replace("/*__DATA__*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL("replay.html", outDir), html);
console.log(`wrote ${new URL("replay.html", outDir).pathname} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
