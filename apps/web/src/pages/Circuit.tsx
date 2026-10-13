import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { TEAMS, circuitBrand } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";
import { LapsTable } from "../components/Laps";
import { Replay } from "../components/Replay";
import { useAgents } from "../lib/agents";
import { km, lapTime } from "../lib/format";
import { useTrack } from "../lib/useTrack";
import { useRun } from "../sim/useRun";

export function Circuit() {
  const { id = "spielberg" } = useParams();
  const [params, setParams] = useSearchParams();
  const { agents } = useAgents();
  const track = useTrack(id);
  const brand = circuitBrand(id);
  const agentId = params.get("agent") ?? agents[0]!.id;
  const agent = agents.find((a) => a.id === agentId) ?? agents[0]!;
  const [teamId, setTeamId] = useState<string>(TEAMS[0].id);
  const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  const run = useRun(id, agent.text);
  const [seed, setSeed] = useState<number>(1);

  // Replay the median lap once it's known; until then the first lap that arrives.
  const medianSeed = useMemo(() => run.laps.find((l) => l.status === "finished" && l.steps === run.medianSteps)?.seed, [run.laps, run.medianSteps]);
  useEffect(() => setSeed(medianSeed ?? 1), [medianSeed, agent.id, id]);
  const lap = run.laps.find((l) => l.seed === seed) ?? run.laps[0];

  return (
    <div className="wrap page">
      <nav className="small muted">
        <Link to="/circuits">Circuits</Link> / {brand.name}
      </nav>
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>{brand.name}</h1>
          <p className="muted">
            {brand.location}. {track ? `${km(track.officialLengthM)}, ${track.gates.length} gates` : "…"}, rules {R.id}.
          </p>
        </div>
        <div className="row">
          <label className="row small">
            Agent
            <select value={agent.id} onChange={(e) => setParams({ agent: e.target.value })}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="row small">
            Livery
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              {TEAMS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.real.name}
                </option>
              ))}
            </select>
          </label>
          <Link to={`/upload?circuit=${id}`} className="btn small">
            Upload another agent
          </Link>
        </div>
      </div>

      {track && lap?.trace ? (
        <Replay track={track} lap={lap} colors={team.real.colors} />
      ) : (
        <div className="panel panel-pad muted" style={{ minHeight: 320, display: "grid", placeItems: "center" }}>
          {run.phase === "rejected" ? "This agent didn't pass the checks. Open it on the upload page to see why." : "Running the first lap in your browser…"}
        </div>
      )}

      <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(420px, 100%), 1fr))" }}>
        <section className="panel">
          <div className="panel-pad spread" style={{ paddingBottom: 8 }}>
            <h3>Official laps</h3>
            <span className="small muted">Click a lap to replay it</span>
          </div>
          <LapsTable laps={run.laps} medianSteps={run.medianSteps} selected={lap?.seed} onSelect={setSeed} />
          <div className="panel-pad spread">
            <div className="stat">
              <div className="k">Median lap</div>
              <div className="v">{run.medianSteps !== null ? lapTime(run.medianSteps) : run.phase === "done" ? "Not ranked" : "…"}</div>
            </div>
            <button className="btn primary" disabled title="Server verification is coming next">
              Submit to the leaderboard
            </button>
          </div>
          <p className="small muted" style={{ padding: "0 20px 16px" }}>
            A lap ends if any corner of the car leaves the track, the car stops for two seconds, or it runs past {R.timing.maxSteps.toLocaleString()} steps.
            Submitting opens once our servers can re-run laps. <Link to="/rules">Full rules</Link>
          </p>
        </section>
        <section className="panel panel-pad stack">
          <h3>About this agent</h3>
          {run.summary ? (
            <dl className="kv">
              <dt>Type</dt>
              <dt>Nodes</dt>
              <dt>Parameters</dt>
              <dd>{run.summary.kind === "mlp" ? "MLP" : "NEAT genome"}</dd>
              <dd>{run.summary.nodes}</dd>
              <dd>{run.summary.parameters}</dd>
            </dl>
          ) : (
            <p className="muted small">Checking…</p>
          )}
          <p className="small muted">
            {agent.demo
              ? "A tiny example agent with a handful of hand-placed weights. It's cautious and slow, so there's plenty of time to find."
              : `${agent.name}, fingerprint ${run.summary?.fingerprint.slice(0, 6) ?? "…"}.`}
          </p>
          <p className="small muted">
            Every lap above ran in your browser, in the same WebAssembly build our servers use. Each starts from one of three published positions: seed 1 is 0.5 m
            left, seed 3 is 0.5 m right.
          </p>
        </section>
      </div>
    </div>
  );
}
