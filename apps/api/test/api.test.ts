import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { parseAgent } from "@fevo/agent-format";
import { runOfficialLaps } from "@fevo/sim";
import { createApp } from "../src/app.ts";
import { Auth } from "../src/auth.ts";
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
  const auth = new Auth(db.db, { siteUrl: "http://site.test", devLogin: true, github: { clientId: "cid", clientSecret: "secret" }, fetch: fakeGitHub });
  app = createApp(subs, auth, { submitsPerHour: 5 });
});

/** GitHub's token and user endpoints, for the OAuth test. */
async function fakeGitHub(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const u = String(url);
  if (u === "https://github.com/login/oauth/access_token") {
    const { code } = JSON.parse(String(init!.body)) as { code: string };
    return Response.json(code === "good" ? { access_token: "gho_test" } : { error: "bad_verification_code" });
  }
  if (u === "https://api.github.com/user") {
    assert.equal(new Headers(init!.headers).get("authorization"), "Bearer gho_test");
    return Response.json({ id: 44432182, login: "shimorojune", name: "Rohit", avatar_url: "https://avatars.example/1" });
  }
  throw new Error(`unexpected fetch ${u}`);
}

const sessions = new Map<string, string>();
/** Session cookie for a dev login, signing in on first use. */
async function cookieFor(login: string): Promise<string> {
  let c = sessions.get(login);
  if (!c) {
    const res = await app.request("/api/auth/dev", { method: "POST", body: JSON.stringify({ login }), headers: { "content-type": "application/json" } });
    assert.equal(res.status, 200);
    c = res.headers.get("set-cookie")!.split(";")[0]!;
    sessions.set(login, c);
  }
  return c;
}
after(async () => {
  await pool.close();
  await db.close();
});

const submit = async (body: unknown, login: string | null = "house") =>
  app.request("/api/submissions", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(login ? { cookie: await cookieFor(login) } : {}) },
  });

test("a submission whose laps match the browser's is verified and ranked", async () => {
  const agent = example("genome");
  const claimed = browserLaps(agent, "spielberg");
  const res = await submit({ circuit: "spielberg", agent, claimed });
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
  const res = await submit({ circuit: "spielberg", agent: example("genome") }, "someone-else");
  assert.equal(res.status, 200);
  const body = (await res.json()) as { duplicate: boolean; submission: { driver: string } };
  assert.equal(body.duplicate, true);
  assert.equal(body.submission.driver, "house");
});

test("laps that differ from the browser's are a mismatch and never ranked", async () => {
  const agent = example("mlp");
  const claimed = browserLaps(agent, "monza");
  claimed[1] = { ...claimed[1]!, steps: claimed[1]!.steps - 1 };
  const res = await submit({ circuit: "monza", agent, claimed }, "tamper");
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
  const res = await submit({ circuit: "austin", agent: parked }, "parked");
  const { submission } = (await res.json()) as { submission: { id: string } };
  await subs.drain();
  const s = (await (await app.request(`/api/submissions/${submission.id}`)).json()) as { status: string };
  assert.equal(s.status, "unranked");
});

test("bad input is rejected with a reason", async () => {
  const invalid = await submit({ circuit: "spielberg", agent: "{ not json" }, "b");
  assert.equal(invalid.status, 422);
  assert.ok(((await invalid.json()) as { errors: unknown[] }).errors.length > 0);
  assert.equal((await submit({ circuit: "nowhere", agent: parked }, "b")).status, 400);
  assert.equal((await submit({ circuit: "monza", agent: parked, claimed: [{ seed: "0" }] }, "b")).status, 400);
  const text = await app.request("/api/submissions", { method: "POST", body: JSON.stringify({ circuit: "monza", agent: parked }), headers: { "content-type": "text/plain", cookie: await cookieFor("b") } });
  assert.equal(text.status, 400);
  assert.equal((await app.request("/api/leaderboard/nowhere")).status, 404);
  assert.equal((await app.request("/api/submissions/nope")).status, 404);
});

test("submitting needs a signed-in account", async () => {
  const res = await submit({ circuit: "monza", agent: parked }, null);
  assert.equal(res.status, 401);
  const forged = await app.request("/api/submissions", { method: "POST", body: "{}", headers: { "content-type": "application/json", cookie: "fevo_session=forged" } });
  assert.equal(forged.status, 401);
});

test("submissions are rate limited per account", async () => {
  const mlp = JSON.parse(example("mlp")) as { weights: number[][] };
  const variant = (i: number) => {
    const m = structuredClone(mlp);
    m.weights[0]![0] = (i + 1) / 1000; // differs from the plain example used above
    return JSON.stringify(m);
  };
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await submit({ circuit: "monza", agent: variant(i) }, "spam")).status);
  await subs.drain();
  assert.deepEqual(codes, [202, 202, 202, 202, 202, 429]);
});

test("queued rows left by a restart are verified on resume", async () => {
  const fresh = new Submissions(db.db, pool);
  const agent = example("genome");
  const res = await submit({ circuit: "monza", agent }, "restart");
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

test("the board shows each driver's best entry only", async () => {
  // Two networks from one driver on Austin: the example genome and the example MLP.
  const ids: string[] = [];
  for (const name of ["genome", "mlp"]) {
    const agent = example(name);
    const res = await submit({ circuit: "austin", agent, claimed: browserLaps(agent, "austin") }, "two-cars");
    ids.push(((await res.json()) as { submission: { id: string } }).submission.id);
  }
  await subs.drain();
  const all = await Promise.all(ids.map(async (id) => (await (await app.request(`/api/submissions/${id}`)).json()) as { id: string; status: string; medianSteps: number }));
  assert.ok(all.every((s) => s.status === "verified"));
  const fastest = all.reduce((a, b) => (b.medianSteps < a.medianSteps ? b : a));
  const board = (await (await app.request("/api/leaderboard/austin")).json()) as { entries: { id: string; driver: string }[] };
  const mine = board.entries.filter((e) => e.driver === "two-cars");
  assert.deepEqual(mine.map((e) => e.id), [fastest.id]);
});

test("GitHub sign-in: state is checked, the session works, and sign-out ends it", async () => {
  const start = await app.request("/api/auth/github?return=/upload?circuit=monza");
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("location")!);
  assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(to.searchParams.get("redirect_uri"), "http://site.test/api/auth/github/callback");
  const state = to.searchParams.get("state")!;
  const stateCookie = start.headers.get("set-cookie")!.split(";")[0]!;

  const wrong = await app.request(`/api/auth/github/callback?code=good&state=nope`, { headers: { cookie: stateCookie } });
  assert.equal(wrong.headers.get("location"), "http://site.test/upload?circuit=monza&signin=expired");
  assert.ok(!wrong.headers.get("set-cookie")?.includes("fevo_session="));

  const ok = await app.request(`/api/auth/github/callback?code=good&state=${state}`, { headers: { cookie: stateCookie } });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "http://site.test/upload?circuit=monza");
  const session = ok.headers.getSetCookie().find((c) => c.startsWith("fevo_session="))!;
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  const cookie = session.split(";")[0]!;

  const me = (await (await app.request("/api/me", { headers: { cookie } })).json()) as { user: { id: string; login: string } };
  assert.deepEqual([me.user.id, me.user.login], ["44432182", "shimorojune"]);

  await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
  const after = (await (await app.request("/api/me", { headers: { cookie } })).json()) as { user: unknown };
  assert.equal(after.user, null);
});

test("sign-in never redirects off the site", async () => {
  for (const ret of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
    const start = await app.request(`/api/auth/github?return=${encodeURIComponent(ret)}`);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cookie = start.headers.get("set-cookie")!.split(";")[0]!;
    const done = await app.request(`/api/auth/github/callback?code=good&state=${state}`, { headers: { cookie } });
    assert.equal(done.headers.get("location"), "http://site.test/");
  }
});
