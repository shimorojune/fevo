/**
 * Submission lifecycle: accept (validate, dedupe, store as queued), verify in
 * a worker, record the verdict. Rows left queued by a restart are picked up
 * again by resume().
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { fingerprint, parameterCount, parseAgent, type AgentError } from "@fevo/agent-format";
import { submissions, type Db, type Submission } from "./db.ts";
import type { Verifier } from "./pool.ts";
import { agentShape, RULES, SIM_WASM_SHA256 } from "./season.ts";
import type { ClaimedLap } from "./verify.ts";

export interface NewSubmission {
  /** The submitter's GitHub login, shown on the board. */
  driver: string;
  userId: string;
  circuit: string;
  agentText: string;
  claimed?: ClaimedLap[] | undefined;
}

export type Accepted =
  | { ok: true; submission: Submission; duplicate: boolean }
  | { ok: false; errors: AgentError[] };

export class Submissions {
  readonly #db: Db;
  readonly #verifier: Verifier;
  readonly #inflight = new Set<Promise<void>>();

  constructor(db: Db, verifier: Verifier) {
    this.#db = db;
    this.#verifier = verifier;
  }

  async submit(s: NewSubmission): Promise<Accepted> {
    const parsed = parseAgent(s.agentText, agentShape());
    if (!parsed.ok) return { ok: false, errors: parsed.errors };
    const fp = await fingerprint(parsed.program);
    // One entry per network per circuit: resubmitting the same weights returns the first entry.
    const [existing] = await this.#db
      .select()
      .from(submissions)
      .where(and(eq(submissions.rulesId, RULES.id), eq(submissions.circuit, s.circuit), eq(submissions.fingerprint, fp)));
    if (existing) return { ok: true, submission: existing, duplicate: true };
    const [row] = await this.#db
      .insert(submissions)
      .values({
        id: randomUUID(),
        driver: s.driver,
        userId: s.userId,
        circuit: s.circuit,
        rulesId: RULES.id,
        fingerprint: fp,
        kind: parsed.program.kind,
        parameters: parameterCount(parsed.program),
        agent: s.agentText,
        claimed: s.claimed ?? null,
        status: "queued",
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return this.submit(s); // lost a race with an identical submission
    this.#track(this.#process(row));
    return { ok: true, submission: row, duplicate: false };
  }

  async get(id: string): Promise<Submission | undefined> {
    const [row] = await this.#db.select().from(submissions).where(eq(submissions.id, id));
    return row;
  }

  /**
   * Verified entries for a circuit, fastest first, one per driver (their best);
   * ties go to the earlier submission.
   */
  async board(circuit: string, limit = 100): Promise<Submission[]> {
    const rows = await this.#db
      .select()
      .from(submissions)
      .where(and(eq(submissions.rulesId, RULES.id), eq(submissions.circuit, circuit), eq(submissions.status, "verified")))
      .orderBy(asc(submissions.medianSteps), asc(submissions.createdAt));
    const seen = new Set<string>();
    const best: Submission[] = [];
    for (const r of rows) {
      // Entries from before sign-in have no account; each stands on its own.
      const who = r.userId ?? `entry:${r.id}`;
      if (seen.has(who)) continue;
      seen.add(who);
      best.push(r);
      if (best.length === limit) break;
    }
    return best;
  }

  /** Re-verify anything a previous process left queued. */
  async resume(): Promise<number> {
    const rows = await this.#db.select().from(submissions).where(eq(submissions.status, "queued"));
    for (const r of rows) this.#track(this.#process(r));
    return rows.length;
  }

  /** Wait for every verification started so far (tests, graceful shutdown). */
  async drain(): Promise<void> {
    while (this.#inflight.size) await Promise.all(this.#inflight);
  }

  #track(p: Promise<void>) {
    this.#inflight.add(p);
    void p.finally(() => this.#inflight.delete(p));
  }

  async #process(row: Submission): Promise<void> {
    try {
      const v = await this.#verifier.verify({ circuitId: row.circuit, agentText: row.agent, claimed: row.claimed ?? undefined });
      await this.#db
        .update(submissions)
        .set({ status: v.verdict, detail: v.detail ?? null, laps: v.laps, medianSteps: v.medianSteps, simSha256: SIM_WASM_SHA256, verifiedAt: new Date() })
        .where(eq(submissions.id, row.id));
    } catch (err) {
      await this.#db
        .update(submissions)
        .set({ status: "failed", detail: err instanceof Error ? err.message : String(err), verifiedAt: new Date() })
        .where(eq(submissions.id, row.id));
    }
  }
}
