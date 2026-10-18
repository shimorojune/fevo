/**
 * fevo: publish models and training progress to the dashboard API.
 *
 *   FEVO_API   the dashboard's URL, e.g. https://fevo.example.dev
 *   FEVO_KEY   the API's PUBLISH_KEY
 *
 *   fevo publish <agent.json> --name <name> [--rules solo-1] [--status candidate|house] [--run <id>] [--parent <id>]
 *                [--notes <text>] [--laps <extra-laps.json>]
 *       Runs the official laps on every track the API has, here, then posts the model with them.
 *       The API re-runs the clean laps and refuses the model if any differ. --laps adds laps run
 *       elsewhere (e.g. the error-level benchmark from Python): a JSON list of
 *       { trackId, seed, errorLevel, status, steps, hash }, stored as reported.
 *   fevo track <id> <track.json> --name <name> [--kind real|procedural] [--expert <seconds>] [--held-out]
 *   fevo run start --name <name> --method <ES|imitation|...> [--machine <name>] [--config <file.json>]   prints the run id
 *   fevo run metric <run-id> <step> <key=value>...
 *   fevo run end <run-id> [--status done|failed|stopped] [--best <model-id>]
 */
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { parseAgent } from "@fevo/agent-format";
import { SOLO_1, type Rules } from "@fevo/rules";
import { runOfficialLaps } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";

/** Rules versions this checkout can run locally. Keep in step with apps/api/src/rules.ts. */
const RULES: Record<string, Rules> = { [SOLO_1.id]: SOLO_1 };

const API = process.env.FEVO_API?.replace(/\/$/, "");
const KEY = process.env.FEVO_KEY;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!API || !KEY) fail("Set FEVO_API and FEVO_KEY.");
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const out = (await res.json().catch(() => ({}))) as T & { error?: string; errors?: { message: string }[] };
  if (!res.ok) fail(`${method} ${path}: ${res.status} ${out.error ?? ""}${out.errors ? `\n  ${out.errors.map((e) => e.message).join("\n  ")}` : ""}`);
  return out;
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case "publish": {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { name: { type: "string" }, rules: { type: "string" }, status: { type: "string" }, run: { type: "string" }, parent: { type: "string" }, notes: { type: "string" }, laps: { type: "string" } },
    });
    const file = positionals[0] ?? fail("usage: fevo publish <agent.json> --name <name>");
    if (!values.name) fail("--name is required.");
    const rules = RULES[values.rules ?? SOLO_1.id] ?? fail(`This checkout can't run rules ${values.rules}; it knows ${Object.keys(RULES).join(", ")}.`);
    const agent = readFileSync(file, "utf8");
    const parsed = parseAgent(agent, { inputs: rules.observation.length, outputs: rules.action.length, setup: rules.setup });
    if (!parsed.ok) fail(`${file} doesn't pass validation:\n  ${parsed.errors.map((e) => e.message).join("\n  ")}`);

    const { tracks } = await call<{ tracks: { id: string; name: string }[] }>("GET", "/api/tracks");
    const laps: unknown[] = [];
    for (const t of tracks) {
      const { data } = await call<{ data: TrackFile }>("GET", `/api/tracks/${t.id}`);
      const r = runOfficialLaps(rules, data, parsed.program);
      for (const l of r.laps) laps.push({ trackId: t.id, seed: l.seed, errorLevel: 0, status: l.status, steps: l.steps, hash: l.hash });
      console.log(`${t.name.padEnd(28)} ${r.laps.map((l) => (l.status === "finished" ? String(l.steps) : l.status)).join(" / ")}${r.medianSteps !== null ? `  median ${(r.medianSteps / rules.timing.agentHz).toFixed(2)} s` : ""}`);
    }
    if (values.laps) laps.push(...(JSON.parse(readFileSync(values.laps, "utf8")) as unknown[]));

    const out = await call<{ duplicate: boolean; model: { id: string; name: string } }>("POST", "/api/models", {
      name: values.name,
      rules: rules.id,
      agent,
      laps,
      ...(values.status ? { status: values.status } : {}),
      ...(values.run ? { runId: values.run } : {}),
      ...(values.parent ? { parentId: values.parent } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    });
    console.log(out.duplicate ? `Already published as "${out.model.name}" (${out.model.id}).` : `Published ${out.model.id}`);
    break;
  }

  case "track": {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { name: { type: "string" }, kind: { type: "string", default: "real" }, expert: { type: "string" }, "held-out": { type: "boolean", default: false } },
    });
    const [id, file] = positionals;
    if (!id || !file || !values.name) fail("usage: fevo track <id> <track.json> --name <name>");
    const data = JSON.parse(readFileSync(file, "utf8")) as TrackFile;
    await call("PUT", `/api/tracks/${id}`, { name: values.name, kind: values.kind, data, expertLapS: values.expert ? Number(values.expert) : null, heldOut: values["held-out"] });
    console.log(`Track ${id} saved.`);
    break;
  }

  case "run": {
    const [sub, ...args] = rest;
    if (sub === "start") {
      const { values } = parseArgs({ args, options: { name: { type: "string" }, method: { type: "string" }, machine: { type: "string" }, config: { type: "string" } } });
      if (!values.name || !values.method) fail("usage: fevo run start --name <name> --method <method>");
      const run = await call<{ id: string }>("POST", "/api/runs", {
        name: values.name,
        method: values.method,
        machine: values.machine ?? hostname(),
        ...(values.config ? { config: JSON.parse(readFileSync(values.config, "utf8")) } : {}),
      });
      console.log(run.id);
    } else if (sub === "metric") {
      const [id, step, ...pairs] = args;
      if (!id || !step || !pairs.length) fail("usage: fevo run metric <run-id> <step> <key=value>...");
      const values = Object.fromEntries(pairs.map((p) => p.split("=")).map(([k, v]) => [k!, Number(v)]));
      await call("POST", `/api/runs/${id}/metrics`, { step: Number(step), values });
    } else if (sub === "end") {
      const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { status: { type: "string", default: "done" }, best: { type: "string" } } });
      const id = positionals[0] ?? fail("usage: fevo run end <run-id>");
      await call("PATCH", `/api/runs/${id}`, { status: values.status, ...(values.best ? { bestModelId: values.best } : {}) });
    } else fail("usage: fevo run start|metric|end ...");
    break;
  }

  default:
    fail(readFileSync(new URL(import.meta.url), "utf8").match(/\/\*\*([\s\S]*?)\*\//)![1]!.replace(/^ \* ?/gm, "").trim());
}
