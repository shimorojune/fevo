/**
 * HTTP API for the fevo dashboard. The dashboard signs in and reads; training
 * (fevo publish and the trainer's progress hook) writes with the publish key.
 * Optionally serves the built dashboard too, so one app on one origin is the
 * whole deployment.
 */
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { MAX_FILE_BYTES } from "@fevo/agent-format";
import { formatLapTime } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";
import type { Auth } from "./auth.ts";
import { MODEL_STATUS, RUN_STATUS, type ModelStatus, type RunStatus } from "./db.ts";
import { DEFAULT_RULES, RULES_BY_ID, SIM_WASM_SHA256 } from "./rules.ts";
import type { PostedLap, Store, StoreEvent } from "./store.ts";

export interface AppOptions {
  /** Client address for login throttling. Behind a proxy, read its forwarded header. */
  clientAddress?: (c: Context) => string;
  /** Directory of the built dashboard (apps/web/dist) to serve at /. */
  webDist?: string | undefined;
}

const ID = /^[a-z0-9][a-z0-9-_.]{0,63}$/;

export function createApp(store: Store, auth: Auth, opts: AppOptions = {}) {
  const app = new Hono();
  const address = opts.clientAddress ?? ((c) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local");
  const bad = (c: Context, error: string) => c.json({ error }, 400);
  const json = async (c: Context) => {
    const body = await c.req.json().catch(() => undefined);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  };

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Session

  app.post("/api/login", async (c) => {
    const body = await json(c);
    if (typeof body?.user !== "string" || typeof body.password !== "string") return bad(c, "Send { user, password }.");
    const r = auth.login(c, body.user, body.password, address(c));
    if (r === "locked") return c.json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    if (r === "bad") return c.json({ error: "Wrong username or password." }, 401);
    return c.json({ user: body.user });
  });
  app.post("/api/logout", (c) => {
    auth.logout(c);
    return c.json({ ok: true });
  });
  app.get("/api/me", (c) => {
    const user = auth.user(c);
    return user ? c.json({ user }) : c.json({ error: "Not signed in." }, 401);
  });

  // Reads: the dashboard, or training with the publish key.
  const reader = async (c: Context, next: () => Promise<void>) => (auth.user(c) ? next() : auth.requireKey(c, next));
  app.use("/api/server", reader);
  app.use("/api/tracks", reader);
  app.use("/api/tracks/*", reader);
  app.use("/api/models", reader);
  app.use("/api/models/*", reader);
  app.use("/api/runs", reader);
  app.use("/api/runs/*", reader);

  app.get("/api/server", (c) =>
    c.json({ simSha256: SIM_WASM_SHA256, defaultRules: DEFAULT_RULES.id, rules: [...RULES_BY_ID.values()].map((r) => ({ id: r.id, simVersion: r.simVersion, seeds: r.seeds.length })) }),
  );

  // Tracks

  app.get("/api/tracks", async (c) => c.json({ tracks: await store.listTracks() }));
  app.get("/api/tracks/:id", async (c) => {
    const t = await store.getTrack(c.req.param("id"));
    return t ? c.json(t) : c.json({ error: "No such track." }, 404);
  });
  app.put("/api/tracks/:id", auth.requireKey, bodyLimit({ maxSize: 4 * 1024 * 1024 }), async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return bad(c, "Track id: lowercase letters, digits, - _ .");
    const body = await json(c);
    if (!body) return bad(c, "Send a JSON body.");
    const { name, kind, data, expertLapS, heldOut } = body;
    if (typeof name !== "string" || !name.trim()) return bad(c, "name is required.");
    if (kind !== "real" && kind !== "procedural") return bad(c, 'kind must be "real" or "procedural".');
    if (!isTrackFile(data)) return bad(c, "data must be a baked track file (schema 1).");
    if (expertLapS !== undefined && expertLapS !== null && typeof expertLapS !== "number") return bad(c, "expertLapS must be seconds.");
    if (heldOut !== undefined && typeof heldOut !== "boolean") return bad(c, "heldOut must be true or false.");
    return c.json(await store.upsertTrack({ id, name: name.trim(), kind, data, expertLapS: expertLapS as number | null | undefined, heldOut: heldOut as boolean | undefined }));
  });

  // Models

  app.get("/api/models", async (c) => {
    const rows = await store.listModels();
    return c.json({ models: rows.map(withTimes) });
  });
  app.get("/api/models/:id", async (c) => {
    const m = await store.getModel(c.req.param("id"));
    return m ? c.json(m) : c.json({ error: "No such model." }, 404);
  });
  // Agent JSON is at most MAX_FILE_BYTES; the laps of a full benchmark add a little.
  app.post("/api/models", auth.requireKey, bodyLimit({ maxSize: MAX_FILE_BYTES + 1024 * 1024 }), async (c) => {
    const body = await json(c);
    if (!body) return bad(c, "Send a JSON body.");
    const { name, rules, agent, status, runId, parentId, notes, laps } = body;
    if (typeof name !== "string" || !name.trim() || name.length > 80) return bad(c, "name: 1 to 80 characters.");
    if (typeof agent !== "string") return bad(c, "agent must be the agent file's JSON text.");
    if (rules !== undefined && typeof rules !== "string") return bad(c, "rules must be a rules id.");
    if (status !== undefined && !MODEL_STATUS.includes(status as ModelStatus)) return bad(c, `status must be one of ${MODEL_STATUS.join(", ")}.`);
    for (const [k, v] of Object.entries({ runId, parentId, notes })) if (v !== undefined && typeof v !== "string") return bad(c, `${k} must be a string.`);
    if (laps !== undefined && !isPostedLaps(laps)) return bad(c, "laps must be a list of { trackId, seed, errorLevel?, status, steps, hash }.");
    const r = await store.publish({
      name: name.trim(),
      rulesId: (rules as string | undefined) ?? DEFAULT_RULES.id,
      agentText: agent,
      status: status as ModelStatus | undefined,
      runId: runId as string | undefined,
      parentId: parentId as string | undefined,
      notes: notes as string | undefined,
      laps: laps as PostedLap[] | undefined,
    });
    if (!r.ok) return c.json({ error: r.error, errors: r.errors }, r.status);
    return c.json({ duplicate: r.duplicate, model: withTimes(r.model) }, r.duplicate ? 200 : 201);
  });
  app.patch("/api/models/:id", async (c) => {
    const body = await json(c);
    if (!body) return bad(c, "Send a JSON body.");
    const { name, status, notes } = body;
    if (name !== undefined && (typeof name !== "string" || !name.trim() || name.length > 80)) return bad(c, "name: 1 to 80 characters.");
    if (status !== undefined && !MODEL_STATUS.includes(status as ModelStatus)) return bad(c, `status must be one of ${MODEL_STATUS.join(", ")}.`);
    if (notes !== undefined && notes !== null && typeof notes !== "string") return bad(c, "notes must be text.");
    const m = await store.updateModel(c.req.param("id"), {
      ...(name !== undefined ? { name: (name as string).trim() } : {}),
      ...(status !== undefined ? { status: status as ModelStatus } : {}),
      ...(notes !== undefined ? { notes: notes as string | null } : {}),
    });
    return m ? c.json(withTimes(m)) : c.json({ error: "No such model." }, 404);
  });

  // Training runs

  app.get("/api/runs", async (c) => c.json({ runs: await store.listRuns() }));
  app.get("/api/runs/:id", async (c) => {
    const r = await store.getRun(c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "No such run." }, 404);
  });
  app.post("/api/runs", auth.requireKey, async (c) => {
    const body = await json(c);
    if (!body) return bad(c, "Send a JSON body.");
    const { name, method, machine, config, notes } = body;
    if (typeof name !== "string" || !name.trim()) return bad(c, "name is required.");
    if (typeof method !== "string" || !method.trim()) return bad(c, "method is required (ES, imitation, ...).");
    if (machine !== undefined && typeof machine !== "string") return bad(c, "machine must be a string.");
    if (notes !== undefined && typeof notes !== "string") return bad(c, "notes must be a string.");
    if (config !== undefined && (typeof config !== "object" || config === null || Array.isArray(config))) return bad(c, "config must be an object.");
    const run = await store.createRun({
      name: name.trim(),
      method: method.trim(),
      machine: machine as string | undefined,
      config: config as Record<string, unknown> | undefined,
      notes: notes as string | undefined,
    });
    return c.json(run, 201);
  });
  app.patch("/api/runs/:id", async (c, next) => (auth.user(c) ? next() : auth.requireKey(c, next)), async (c) => {
    const body = await json(c);
    if (!body) return bad(c, "Send a JSON body.");
    const { status, notes, bestModelId } = body;
    if (status !== undefined && !RUN_STATUS.includes(status as RunStatus)) return bad(c, `status must be one of ${RUN_STATUS.join(", ")}.`);
    if (notes !== undefined && notes !== null && typeof notes !== "string") return bad(c, "notes must be text.");
    if (bestModelId !== undefined && bestModelId !== null && typeof bestModelId !== "string") return bad(c, "bestModelId must be a model id.");
    const run = await store.updateRun(c.req.param("id"), {
      ...(status !== undefined ? { status: status as RunStatus } : {}),
      ...(notes !== undefined ? { notes: notes as string | null } : {}),
      ...(bestModelId !== undefined ? { bestModelId: bestModelId as string | null } : {}),
    });
    return run ? c.json(run) : c.json({ error: "No such run." }, 404);
  });
  app.post("/api/runs/:id/metrics", auth.requireKey, bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    // One { step, values } or a list of them.
    const list = Array.isArray(body) ? body : [body];
    if (!list.length || list.length > 1000 || !list.every(isMetric)) return bad(c, "Send { step, values: { name: number, ... } } or a list of them.");
    const ok = await store.addMetrics(c.req.param("id"), list as { step: number; values: Record<string, number> }[]);
    return ok ? c.json({ ok: true, count: list.length }) : c.json({ error: "No such run." }, 404);
  });

  // Drives: laps run from the dashboard's Run screen, listed in History.

  app.get("/api/drives", auth.requireUser, async (c) => {
    const q = c.req.query();
    const limit = q.limit ? Number(q.limit) : undefined;
    if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) return bad(c, "limit must be a positive whole number.");
    return c.json({ drives: (await store.listDrives({ modelId: q.model, trackId: q.track, status: q.status, limit })).map(withDriveTime) });
  });
  app.get("/api/drives/:id", auth.requireUser, async (c) => {
    const id = Number(c.req.param("id"));
    const d = Number.isInteger(id) ? await store.getDrive(id) : undefined;
    return d ? c.json(withDriveTime(d)) : c.json({ error: "No such run." }, 404);
  });
  app.post("/api/drives", auth.requireUser, async (c) => {
    const body = await json(c);
    if (!body) return bad(c, "Send a JSON body.");
    const { modelId, trackId, seed, errorLevel, noiseSeed, ghostModelId, status, steps, gatesPassed, hash } = body;
    if (typeof modelId !== "string" || typeof trackId !== "string") return bad(c, "modelId and trackId are required.");
    if (!Number.isInteger(seed) || (seed as number) < 0) return bad(c, "seed must be a whole number from 0.");
    if (typeof errorLevel !== "number" || !(errorLevel >= 0 && errorLevel <= 1)) return bad(c, "errorLevel must be between 0 and 1.");
    if (!Number.isInteger(noiseSeed)) return bad(c, "noiseSeed must be a whole number.");
    if (ghostModelId !== undefined && ghostModelId !== null && typeof ghostModelId !== "string") return bad(c, "ghostModelId must be a model id.");
    if (typeof status !== "string" || !["finished", "crashed", "stopped", "timed-out", "error"].includes(status)) return bad(c, "status must be a lap result.");
    if (!Number.isInteger(steps) || (steps as number) < 0 || !Number.isInteger(gatesPassed) || (gatesPassed as number) < 0) return bad(c, "steps and gatesPassed must be whole numbers.");
    if (typeof hash !== "string" || !/^[0-9a-f]{1,64}$/.test(hash)) return bad(c, "hash must be the lap's state hash.");
    const r = await store.addDrive({
      modelId,
      trackId,
      seed: seed as number,
      errorLevel,
      noiseSeed: noiseSeed as number,
      ghostModelId: (ghostModelId as string | null | undefined) ?? undefined,
      status,
      steps: steps as number,
      gatesPassed: gatesPassed as number,
      hash,
      createdBy: auth.user(c) ?? "unknown",
    });
    return r.ok ? c.json(withDriveTime(r.drive), 201) : c.json({ error: r.error }, 404);
  });

  // Live updates for the dashboard.
  app.get("/api/events", auth.requireUser, (c) =>
    streamSSE(c, async (stream) => {
      const payload = (e: StoreEvent) => (e.type === "model" ? { ...e, model: withTimes(e.model) } : e.type === "drive" ? { ...e, drive: withDriveTime(e.drive) } : e);
      const send = (e: StoreEvent) => void stream.writeSSE({ event: e.type, data: JSON.stringify(payload(e)) });
      store.events.on("event", send);
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "" }), 25_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(ping);
      store.events.off("event", send);
    }),
  );

  app.all("/api/*", (c) => c.json({ error: "Not found." }, 404));

  if (opts.webDist) {
    const root = opts.webDist;
    app.use("/*", serveStatic({ root }));
    // Client-side routes all load the app shell.
    app.get("/*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}

/** Adds the lap time, at the drive's rules timing. */
function withDriveTime<D extends { rulesId: string; status: string; steps: number }>(d: D) {
  const hz = RULES_BY_ID.get(d.rulesId)?.timing.agentHz ?? DEFAULT_RULES.timing.agentHz;
  return { ...d, lapTime: d.status === "finished" ? formatLapTime(d.steps, hz) : null };
}

/** Adds lap times per track so the dashboard needn't know each model's rules timing. */
function withTimes<M extends { rulesId: string; benchmark: Record<string, { medianSteps: number | null }> }>(m: M) {
  const hz = RULES_BY_ID.get(m.rulesId)?.timing.agentHz ?? DEFAULT_RULES.timing.agentHz;
  const benchmark = Object.fromEntries(
    Object.entries(m.benchmark).map(([k, b]) => [k, { ...b, lapTime: b.medianSteps === null ? null : formatLapTime(b.medianSteps, hz) }]),
  );
  return { ...m, benchmark };
}

function isPostedLaps(x: unknown): x is PostedLap[] {
  return (
    Array.isArray(x) &&
    x.length <= 2000 &&
    x.every(
      (l) =>
        l &&
        typeof l === "object" &&
        typeof l.trackId === "string" &&
        Number.isInteger(l.seed) &&
        l.seed >= 0 &&
        (l.errorLevel === undefined || (typeof l.errorLevel === "number" && l.errorLevel >= 0)) &&
        typeof l.status === "string" &&
        Number.isInteger(l.steps) &&
        typeof l.hash === "string" &&
        l.hash.length <= 64,
    )
  );
}

function isMetric(x: unknown): boolean {
  if (!x || typeof x !== "object") return false;
  const { step, values } = x as { step?: unknown; values?: unknown };
  return (
    Number.isInteger(step) &&
    !!values &&
    typeof values === "object" &&
    !Array.isArray(values) &&
    Object.keys(values).length <= 32 &&
    Object.values(values).every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function isTrackFile(x: unknown): x is TrackFile {
  if (!x || typeof x !== "object") return false;
  const t = x as Partial<TrackFile>;
  return (
    t.schema === 1 &&
    typeof t.sha256 === "string" &&
    typeof t.lengthM === "number" &&
    Array.isArray(t.centerline) &&
    Array.isArray(t.widthLeft) &&
    Array.isArray(t.widthRight) &&
    Array.isArray(t.gates) &&
    t.centerline.length === 2 * t.widthLeft.length &&
    t.widthLeft.length === t.widthRight.length
  );
}
