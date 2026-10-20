import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { parseAgent } from "@fevo/agent-format";
import { runOfficialLaps } from "@fevo/sim";
import { createApp } from "../src/app.ts";
import { createAuth, hashPassword } from "../src/auth.ts";
import { openDb } from "../src/db.ts";
import { createPool } from "../src/pool.ts";
import { agentShape, bakedTracks, DEFAULT_RULES } from "../src/rules.ts";
import { Store } from "../src/store.ts";

const example = (name: string) => readFileSync(new URL(`../../../examples/example-${name}.json`, import.meta.url), "utf8");
const KEY = "k".repeat(40);
const baked = bakedTracks();

/** The laps fevo publish would report: the same wasm, run in this process. */
function publishedLaps(agentText: string, trackId: string) {
  const p = parseAgent(agentText, agentShape(DEFAULT_RULES));
  assert.ok(p.ok);
  const track = baked.find((t) => t.id === trackId)!.data;
  return runOfficialLaps(DEFAULT_RULES, track, p.program).laps.map(({ seed, status, steps, hash }) => ({ trackId, seed, status, steps, hash }));
}

let db: Awaited<ReturnType<typeof openDb>>;
let pool: ReturnType<typeof createPool>;
let store: Store;
let app: ReturnType<typeof createApp>;
let cookie = "";

before(async () => {
  db = await openDb();
  pool = createPool(2);
  store = new Store(db.db, pool);
  await store.seedTracks(baked);
  const auth = createAuth({ user: "rohit", passwordHash: hashPassword("hunter22"), sessionSecret: "s".repeat(40), publishKey: KEY, secureCookies: false });
  app = createApp(store, auth, { clientAddress: (c) => c.req.header("x-test-client") ?? "a" });
});
after(async () => {
  await pool.close();
  await db.close();
});

const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { "content-type": "application/json", ...headers } });
const withKey = (method: string, path: string, body?: unknown) => send(method, path, body, { authorization: `Bearer ${KEY}` });
const signedIn = (method: string, path: string, body?: unknown) => send(method, path, body, { cookie });

test("sign-in: wrong password is refused, right one sets a session, five failures lock the address", async () => {
  assert.equal((await send("GET", "/api/models")).status, 401);
  assert.equal((await send("POST", "/api/login", { user: "rohit", password: "nope" })).status, 401);
  const ok = await send("POST", "/api/login", { user: "rohit", password: "hunter22" });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get("set-cookie")!.split(";")[0]!;
  assert.equal((await signedIn("GET", "/api/me")).status, 200);
  assert.equal((await send("GET", "/api/me", undefined, { cookie: `${cookie}x` })).status, 401);

  for (let i = 0; i < 5; i++) await send("POST", "/api/login", { user: "rohit", password: "nope" }, { "x-test-client": "z" });
  assert.equal((await send("POST", "/api/login", { user: "rohit", password: "hunter22" }, { "x-test-client": "z" })).status, 429);
});

test("baked tracks are seeded and readable", async () => {
  const { tracks } = (await (await signedIn("GET", "/api/tracks")).json()) as { tracks: { id: string; data?: unknown }[] };
  assert.deepEqual(tracks.map((t) => t.id).sort(), ["austin", "monza", "spielberg"]);
  assert.equal(tracks[0]!.data, undefined);
  const monza = (await (await signedIn("GET", "/api/tracks/monza")).json()) as { data: { circuitId: string } };
  assert.equal(monza.data.circuitId, "monza");
});

test("publishing a model re-runs its official laps and shows its benchmark", async () => {
  const agent = example("genome");
  const laps = [...publishedLaps(agent, "spielberg"), ...publishedLaps(agent, "monza"), { trackId: "monza", seed: 7, errorLevel: 0.03, status: "crashed", steps: 900, hash: "abc" }];
  assert.equal((await send("POST", "/api/models", { name: "House", agent, laps }, { cookie })).status, 401, "the dashboard can't publish");
  const res = await withKey("POST", "/api/models", { name: "House", agent, laps, status: "house" });
  assert.equal(res.status, 201, await res.clone().text());
  const { model } = (await res.json()) as { model: { id: string; status: string; benchmark: Record<string, { finished: number; total: number; medianSteps: number | null; lapTime: string | null }> } };
  assert.equal(model.status, "house");
  const finished = laps.filter((l) => l.trackId === "spielberg" && l.status === "finished").map((l) => l.steps).sort((a, b) => a - b);
  assert.equal(model.benchmark.spielberg!.total, 3);
  assert.equal(model.benchmark.spielberg!.medianSteps, finished.length >= 2 ? finished[1] : null);

  const full = (await (await signedIn("GET", `/api/models/${model.id}`)).json()) as { agent: string; laps: { source: string; errorLevel: number }[] };
  assert.equal(full.agent, agent);
  assert.equal(full.laps.length, 7);
  assert.equal(full.laps.filter((l) => l.source === "server").length, 6);

  const again = await withKey("POST", "/api/models", { name: "Copy", agent });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { duplicate: boolean }).duplicate, true);
});

test("laps that don't reproduce reject the publish", async () => {
  const agent = example("mlp");
  const laps = publishedLaps(agent, "monza");
  laps[1] = { ...laps[1]!, steps: laps[1]!.steps - 1 };
  const res = await withKey("POST", "/api/models", { name: "Tamper", agent, laps });
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { error: string }).error, /seed 2/);
  const { models } = (await (await signedIn("GET", "/api/models")).json()) as { models: { name: string }[] };
  assert.ok(!models.some((m) => m.name === "Tamper"));
});

test("promoting a model to house demotes the previous one", async () => {
  const res = await withKey("POST", "/api/models", { name: "Challenger", agent: example("mlp") });
  const { model } = (await res.json()) as { model: { id: string } };
  const patched = await signedIn("PATCH", `/api/models/${model.id}`, { status: "house", notes: "faster at Monza" });
  assert.equal(patched.status, 200);
  const { models } = (await (await signedIn("GET", "/api/models")).json()) as { models: { name: string; status: string }[] };
  assert.deepEqual(models.filter((m) => m.status === "house").map((m) => m.name), ["Challenger"]);
});

test("training runs take metrics with the key and stream them to a signed-in dashboard", async () => {
  const run = (await (await withKey("POST", "/api/runs", { name: "solo-6 ES", method: "ES", machine: "mac", config: { pop: 64 } })).json()) as { id: string; status: string };
  assert.equal(run.status, "running");

  assert.equal((await send("GET", "/api/events")).status, 401);
  const events = await signedIn("GET", "/api/events");
  assert.equal(events.status, 200);
  const reader = events.body!.getReader();

  assert.equal((await withKey("POST", `/api/runs/${run.id}/metrics`, { step: 1, values: { best: 0.4, clean: 12 } })).status, 200);
  assert.equal((await withKey("POST", `/api/runs/${run.id}/metrics`, [{ step: 2, values: { best: 0.5 } }, { step: 3, values: { best: 0.55 } }])).status, 200);
  assert.equal((await withKey("POST", `/api/runs/${run.id}/metrics`, { step: 4, values: { best: "high" } })).status, 400);
  assert.equal((await withKey("POST", "/api/runs/nope/metrics", { step: 1, values: {} })).status, 404);

  let text = "";
  while (!text.includes('"step":3')) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /event: metrics/);
  await reader.cancel();

  assert.equal((await withKey("PATCH", `/api/runs/${run.id}`, { status: "done" })).status, 200);
  const detail = (await (await signedIn("GET", `/api/runs/${run.id}`)).json()) as { status: string; endedAt: string | null; metrics: { step: number }[] };
  assert.equal(detail.status, "done");
  assert.ok(detail.endedAt);
  assert.deepEqual(detail.metrics.map((m) => m.step), [1, 2, 3]);
});

test("bad input is rejected with a reason", async () => {
  const invalid = await withKey("POST", "/api/models", { name: "X", agent: "{ not json" });
  assert.equal(invalid.status, 422);
  assert.ok(((await invalid.json()) as { errors: unknown[] }).errors.length > 0);
  assert.equal((await withKey("POST", "/api/models", { name: "X", agent: example("mlp"), rules: "solo-99" })).status, 400);
  const fresh = JSON.parse(example("mlp")) as { weights: number[][] };
  fresh.weights[0]![0] = 0.001; // not published yet, so it isn't answered as a duplicate
  assert.equal((await withKey("POST", "/api/models", { name: "X", agent: JSON.stringify(fresh), laps: [{ trackId: "nowhere", seed: 0, status: "finished", steps: 1, hash: "a" }] })).status, 400);
  assert.equal((await withKey("POST", "/api/models", { name: "", agent: example("mlp") })).status, 400);
  assert.equal((await withKey("PUT", "/api/tracks/Bad Id", { name: "x", kind: "real", data: {} })).status, 400);
  assert.equal((await withKey("PUT", "/api/tracks/gen-1", { name: "x", kind: "real", data: { schema: 1 } })).status, 400);
  assert.equal((await signedIn("GET", "/api/models/nope")).status, 404);
  assert.equal((await signedIn("GET", "/api/runs/nope")).status, 404);
});

test("drives: a lap run from the dashboard is saved, verified when it matches, and listed newest first", async () => {
  const { models } = (await (await signedIn("GET", "/api/models")).json()) as { models: { id: string; name: string }[] };
  const house = models.find((m) => m.name === "House")!;
  const lap = publishedLaps(example("genome"), "spielberg")[1]!;
  const base = { modelId: house.id, trackId: "spielberg", seed: 1, noiseSeed: 0, gatesPassed: 107 };
  assert.equal((await withKey("POST", "/api/drives", { ...base, errorLevel: 0, status: lap.status, steps: lap.steps, hash: lap.hash })).status, 401, "the publish key can't save drives");
  const clean = await signedIn("POST", "/api/drives", { ...base, errorLevel: 0, status: lap.status, steps: lap.steps, hash: lap.hash, sectorEnds: [300.5, 640.25] });
  assert.equal(clean.status, 201, await clean.clone().text());
  const c1 = (await clean.json()) as { id: number; verified: boolean; lapTime: string | null; createdBy: string; sectorEnds: number[] };
  assert.deepEqual(c1.sectorEnds, [300.5, 640.25]);
  assert.equal(c1.verified, true);
  assert.equal(c1.createdBy, "rohit");
  assert.ok(c1.lapTime);
  const noisy = (await (await signedIn("POST", "/api/drives", { ...base, errorLevel: 0.06, noiseSeed: 3, status: "crashed", steps: 900, gatesPassed: 40, hash: "beef" })).json()) as { id: number; verified: boolean; lapTime: string | null };
  assert.equal(noisy.verified, false);
  assert.equal(noisy.lapTime, null);
  const { drives } = (await (await signedIn("GET", "/api/drives?track=spielberg")).json()) as { drives: { id: number }[] };
  assert.deepEqual(drives.slice(0, 2).map((d) => d.id), [noisy.id, c1.id]);
  const crashed = (await (await signedIn("GET", "/api/drives?status=crashed")).json()) as { drives: { status: string }[] };
  assert.ok(crashed.drives.length >= 1 && crashed.drives.every((d) => d.status === "crashed"));
  assert.equal((await signedIn("GET", `/api/drives/${c1.id}`)).status, 200);
  assert.equal((await signedIn("POST", "/api/drives", { ...base, modelId: "nope", errorLevel: 0, status: "finished", steps: 1, hash: "a" })).status, 404);
  assert.equal((await signedIn("POST", "/api/drives", { ...base, errorLevel: 2, status: "finished", steps: 1, hash: "a" })).status, 400);
});

test("batches: laps saved with a batch count towards it, it finishes itself, and benchmarks sum them up", async () => {
  const { models } = (await (await signedIn("GET", "/api/models")).json()) as { models: { id: string; name: string }[] };
  const house = models.find((m) => m.name === "House")!;
  const spec = { modelIds: [house.id], trackIds: ["monza"], seeds: [0, 1], errorLevels: [0, 0.06], draws: 2 };
  assert.equal((await withKey("POST", "/api/batches", spec)).status, 401, "the publish key can't start batches");
  assert.equal((await signedIn("POST", "/api/batches", { ...spec, seeds: [0, 0] })).status, 400);
  assert.equal((await signedIn("POST", "/api/batches", { ...spec, draws: 0 })).status, 400);
  assert.equal((await signedIn("POST", "/api/batches", { ...spec, trackIds: ["nowhere"] })).status, 404);
  const created = await signedIn("POST", "/api/batches", spec);
  assert.equal(created.status, 201, await created.clone().text());
  const batch = (await created.json()) as { id: number; total: number; status: string; done: number };
  // 2 seeds x (1 clean + 2 with error)
  assert.equal(batch.total, 6);
  assert.equal(batch.status, "running");
  assert.equal(batch.done, 0);

  const save = (seed: number, errorLevel: number, noiseSeed: number, status: string, steps: number) =>
    signedIn("POST", "/api/drives", { modelId: house.id, trackId: "monza", seed, errorLevel, noiseSeed, status, steps, gatesPassed: status === "finished" ? 144 : 30, hash: "ab", batchId: batch.id });
  assert.equal((await save(0, 0, 0, "finished", 9000)).status, 201);
  assert.equal((await save(0, 0.06, 5, "finished", 9300)).status, 201);
  assert.equal((await save(0, 0.06, 6, "crashed", 2000)).status, 201);
  assert.equal((await signedIn("PATCH", `/api/batches/${batch.id}`, { status: "paused" })).status, 200);
  assert.equal((await signedIn("PATCH", `/api/batches/${batch.id}`, { status: "sideways" })).status, 400);
  const paused = (await (await signedIn("GET", `/api/batches/${batch.id}`)).json()) as { status: string; done: number; finished: number };
  assert.deepEqual([paused.status, paused.done, paused.finished], ["paused", 3, 2]);
  assert.equal((await signedIn("PATCH", `/api/batches/${batch.id}`, { status: "running" })).status, 200);
  assert.equal((await save(1, 0, 0, "finished", 9100)).status, 201);
  assert.equal((await save(1, 0.06, 7, "finished", 9500)).status, 201);
  assert.equal((await save(1, 0.06, 8, "finished", 9400)).status, 201);
  const done = (await (await signedIn("GET", `/api/batches/${batch.id}`)).json()) as { status: string; done: number; endedAt: string | null };
  assert.equal(done.status, "done");
  assert.equal(done.done, 6);
  assert.ok(done.endedAt);
  assert.equal((await signedIn("POST", "/api/drives", { modelId: house.id, trackId: "monza", seed: 0, errorLevel: 0, noiseSeed: 0, status: "finished", steps: 1, gatesPassed: 1, hash: "a", batchId: 999999 })).status, 404);

  const listed = (await (await signedIn("GET", `/api/drives?batch=${batch.id}`)).json()) as { drives: { batchId: number }[] };
  assert.equal(listed.drives.length, 6);
  assert.ok(listed.drives.every((d) => d.batchId === batch.id));
  const { batches } = (await (await signedIn("GET", "/api/batches")).json()) as { batches: { id: number }[] };
  assert.equal(batches[0]!.id, batch.id);

  const { cells } = (await (await signedIn("GET", "/api/benchmarks")).json()) as {
    cells: { modelId: string; trackId: string; errorLevel: number; laps: number; finished: number; medianSteps: number | null; bestSteps: number | null; bestLapTime: string | null }[];
  };
  const noisy = cells.find((x) => x.modelId === house.id && x.trackId === "monza" && x.errorLevel === 0.06)!;
  assert.deepEqual([noisy.laps, noisy.finished, noisy.bestSteps], [4, 3, 9300]);
  assert.equal(noisy.medianSteps, 9400);
  assert.ok(noisy.bestLapTime);
  const clean = cells.find((x) => x.modelId === house.id && x.trackId === "monza" && x.errorLevel === 0)!;
  assert.deepEqual([clean.laps, clean.finished, clean.bestSteps], [2, 2, 9000]);
});
