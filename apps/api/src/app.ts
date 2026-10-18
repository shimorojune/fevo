/** HTTP API. Everything the site needs to submit agents and read the board. */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { MAX_FILE_BYTES } from "@fevo/agent-format";
import { formatLapTime } from "@fevo/sim";
import type { Auth } from "./auth.ts";
import type { Submission } from "./db.ts";
import { CIRCUIT_IDS, RULES, SIM_WASM_SHA256 } from "./season.ts";
import type { Submissions } from "./submissions.ts";
import type { ClaimedLap } from "./verify.ts";

export interface AppOptions {
  /** Origins allowed to call the API from a browser. */
  corsOrigins?: string[] | undefined;
  /** Submissions per account per hour. */
  submitsPerHour?: number;
}

const lapTime = (steps: number | null) => (steps === null ? null : formatLapTime(steps, RULES.timing.agentHz));

const publicSubmission = (s: Submission) => ({
  id: s.id,
  driver: s.driver,
  circuit: s.circuit,
  rules: s.rulesId,
  fingerprint: s.fingerprint,
  kind: s.kind,
  parameters: s.parameters,
  status: s.status,
  detail: s.detail,
  laps: s.laps,
  medianSteps: s.medianSteps,
  lapTime: lapTime(s.medianSteps),
  simSha256: s.simSha256,
  createdAt: s.createdAt,
  verifiedAt: s.verifiedAt,
});

export function createApp(subs: Submissions, auth: Auth, opts: AppOptions = {}) {
  const app = new Hono();
  const perHour = opts.submitsPerHour ?? 20;
  const recent = new Map<string, number[]>();

  app.use("/api/*", cors({ origin: opts.corsOrigins ?? ["http://localhost:5173"], credentials: true }));
  auth.routes(app);

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/season", (c) =>
    c.json({ rules: RULES.id, simVersion: RULES.simVersion, simSha256: SIM_WASM_SHA256, circuits: CIRCUIT_IDS }),
  );

  // Agent JSON is at most MAX_FILE_BYTES; leave room for the envelope and claimed laps.
  app.post("/api/submissions", bodyLimit({ maxSize: MAX_FILE_BYTES + 64 * 1024 }), async (c) => {
    const user = await auth.user(c);
    if (!user) return c.json({ error: "Sign in with GitHub to submit." }, 401);
    const now = Date.now();
    const times = (recent.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
    if (times.length >= perHour) return c.json({ error: "Too many submissions. Try again within the hour." }, 429);

    const bad = (error: string) => c.json({ error }, 400);
    // A JSON content type forces a CORS preflight, so other sites can't post with the session cookie.
    if (!c.req.header("content-type")?.startsWith("application/json")) return bad("Send a JSON body.");
    const body = await c.req.json().catch(() => undefined);
    if (!body || typeof body !== "object") return bad("Send a JSON body.");
    const { circuit, agent, claimed } = body as Record<string, unknown>;
    if (typeof circuit !== "string" || !CIRCUIT_IDS.includes(circuit)) return bad(`Circuit must be one of ${CIRCUIT_IDS.join(", ")}.`);
    if (typeof agent !== "string") return bad("agent must be the agent file's JSON text.");
    if (claimed !== undefined && !isClaimedLaps(claimed)) return bad("claimed must be a list of { seed, status, steps, hash }.");

    const r = await subs.submit({ driver: user.login, userId: user.id, circuit, agentText: agent, claimed });
    if (!r.ok) return c.json({ error: "The agent file didn't pass validation.", errors: r.errors }, 422);
    if (!r.duplicate) recent.set(user.id, [...times, now]);
    return c.json({ duplicate: r.duplicate, submission: publicSubmission(r.submission) }, r.duplicate ? 200 : 202);
  });

  app.get("/api/submissions/:id", async (c) => {
    const s = await subs.get(c.req.param("id"));
    return s ? c.json(publicSubmission(s)) : c.json({ error: "No such submission." }, 404);
  });

  app.get("/api/leaderboard/:circuit", async (c) => {
    const circuit = c.req.param("circuit");
    if (!CIRCUIT_IDS.includes(circuit)) return c.json({ error: "No such circuit." }, 404);
    const rows = await subs.board(circuit);
    return c.json({
      rules: RULES.id,
      circuit,
      entries: rows.map((s, i) => ({
        rank: i + 1,
        id: s.id,
        driver: s.driver,
        userId: s.userId,
        fingerprint: s.fingerprint,
        kind: s.kind,
        parameters: s.parameters,
        medianSteps: s.medianSteps,
        lapTime: lapTime(s.medianSteps),
        createdAt: s.createdAt,
      })),
    });
  });

  return app;
}

function isClaimedLaps(x: unknown): x is ClaimedLap[] {
  return (
    Array.isArray(x) &&
    x.length <= 16 &&
    x.every(
      (l) =>
        l &&
        typeof l === "object" &&
        Number.isInteger(l.seed) &&
        typeof l.status === "string" &&
        Number.isInteger(l.steps) &&
        typeof l.hash === "string" &&
        l.hash.length <= 64,
    )
  );
}
