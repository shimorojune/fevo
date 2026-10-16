import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { parseAgent } from "@fevo/agent-format";
import { runOfficialLaps } from "@fevo/sim";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { createPool } from "../src/pool.ts";
import { agentShape, RULES, trackFor } from "../src/season.ts";
import { Submissions } from "../src/submissions.ts";

const example = (name: string) => readFileSync(new URL(`../../../examples/example-${name}.json`, import.meta.url), "utf8");
const parked = JSON.stringify({ nodes: [{ id: 0, type: "output" }, { id: 1, type: "output", activation: "identity" }], connections: [] });

/** The laps a browser would report: the same wasm, run in this process. */
function browserLaps(agentText: string, circuit: string) {
  const p = parseAgent(agentText, agentShape());
  assert.ok(p.ok);
  return runOfficialLaps(RULES, trackFor(circuit)!, p.program).laps.map(({ seed, status, steps, hash }) => ({ seed, status, steps, hash }));
}

let db: Awaited<ReturnType<typeof openDb>>;
let pool: ReturnType<typeof createPool>;
let subs: Submissions;
let app: ReturnType<typeof createApp>;

before(async () => {
  db = await openDb();
  pool = createPool(2);
  subs = new Submissions(db.db, pool);
  app = createApp(subs, { submitsPerHour: 5, clientAddress: (c) => c.req.header("x-test-client") ?? "a" });
});
after(async () => {
  await pool.close();
  await db.close();
});

const submit = (body: unknown, client = "a") =>
  app.request("/api/submissions", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-test-client": client } });

test("a submission whose laps match the browser's is verified and ranked", async () => {
  const agent = example("genome");
  const claimed = browserLaps(agent, "spielberg");
  const res = await submit({ driver: "House", circuit: "spielberg", agent, claimed });
  assert.equal(res.status, 202);
  const { submission } = (await res.json()) as { submission: { id: string; status: string } };
  assert.equal(submission.status, "queued");
  await subs.drain();

  const s = (await (await app.request(`/api/submissions/${submission.id}`)).json()) as Record<string, unknown>;
  assert.equal(s.status, "verified", String(s.detail));
  const finished = claimed.filter((l) => l.status === "finished").map((l) => l.steps).sort((a, b) => a - b);
  assert.equal(s.medianSteps, finished[1]);

  const board = (await (await app.request("/api/leaderboard/spielberg")).json()) as { entries: { id: string; rank: number; lapTime: string }[] };
  assert.equal(board.entries.length, 1);
  assert.equal(board.entries[0]!.id, submission.id);
  assert.match(board.entries[0]!.lapTime, /^\d:\d\d\.\d\d$/);
});

test("the same network again returns the first entry", async () => {
  const res = await submit({ driver: "Someone else", circuit: "spielberg", agent: example("genome") });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { duplicate: boolean; submission: { driver: string } };
  assert.equal(body.duplicate, true);
  assert.equal(body.submission.driver, "House");
});

test("laps that differ from the browser's are a mismatch and never ranked", async () => {
  const agent = example("mlp");
  const claimed = browserLaps(agent, "monza");
  claimed[1] = { ...claimed[1]!, steps: claimed[1]!.steps - 1 };
  const res = await submit({ driver: "Tamper", circuit: "monza", agent, claimed });
  const { submission } = (await res.json()) as { submission: { id: string } };
  await subs.drain();
  const s = (await (await app.request(`/api/submissions/${submission.id}`)).json()) as { status: string; detail: string; medianSteps: number | null };
  assert.equal(s.status, "mismatch");
  assert.match(s.detail, /seed 2/);
  assert.equal(s.medianSteps, null);
  const board = (await (await app.request("/api/leaderboard/monza")).json()) as { entries: unknown[] };
  assert.equal(board.entries.length, 0);
});

test("an agent that never finishes two laps is unranked", async () => {
  const res = await submit({ driver: "Parked", circuit: "austin", agent: parked });
  const { submission } = (await res.json()) as { submission: { id: string } };
  await subs.drain();
  const s = (await (await app.request(`/api/submissions/${submission.id}`)).json()) as { status: string };
  assert.equal(s.status, "unranked");
});

test("bad input is rejected with a reason", async () => {
  const invalid = await submit({ driver: "X", circuit: "spielberg", agent: "{ not json" }, "b");
  assert.equal(invalid.status, 422);
  assert.ok(((await invalid.json()) as { errors: unknown[] }).errors.length > 0);
  assert.equal((await submit({ driver: "X", circuit: "nowhere", agent: parked }, "b")).status, 400);
  assert.equal((await submit({ driver: "", circuit: "monza", agent: parked }, "b")).status, 400);
  assert.equal((await submit({ driver: "X", circuit: "monza", agent: parked, claimed: [{ seed: "0" }] }, "b")).status, 400);
  assert.equal((await app.request("/api/leaderboard/nowhere")).status, 404);
  assert.equal((await app.request("/api/submissions/nope")).status, 404);
});

test("submissions are rate limited per client", async () => {
  const mlp = JSON.parse(example("mlp")) as { weights: number[][] };
  const variant = (i: number) => {
    const m = structuredClone(mlp);
    m.weights[0]![0] = (i + 1) / 1000; // differs from the plain example used above
    return JSON.stringify(m);
  };
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await submit({ driver: "Spam", circuit: "monza", agent: variant(i) }, "c")).status);
  await subs.drain();
  assert.deepEqual(codes, [202, 202, 202, 202, 202, 429]);
});

test("queued rows left by a restart are verified on resume", async () => {
  const fresh = new Submissions(db.db, pool);
  const agent = example("genome");
  const res = await submit({ driver: "Restart", circuit: "monza", agent }, "d");
  const { submission } = (await res.json()) as { submission: { id: string } };
  await subs.drain();
  // Pretend the process died before verifying.
  const { submissions: table } = await import("../src/db.ts");
  const { eq } = await import("drizzle-orm");
  await db.db.update(table).set({ status: "queued", laps: null, medianSteps: null }).where(eq(table.id, submission.id));
  assert.equal(await fresh.resume(), 1);
  await fresh.drain();
  assert.equal((await fresh.get(submission.id))!.status, "verified");
});
