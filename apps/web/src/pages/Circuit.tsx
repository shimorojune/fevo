import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { TEAMS } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";
import { LapsTable } from "../components/Laps";
import { SetupSummary } from "../components/SetupSummary";
import { Replay } from "../components/Replay";
import { useAgents } from "../lib/agents";
import { api, useApi } from "../lib/api";
import { km, lapTime, trackName } from "../lib/format";
import { useTrack } from "../lib/useTrack";
import { useRun } from "../sim/useRun";

export function Circuit() {
  const { id = "spielberg" } = useParams();
  const [params, setParams] = useSearchParams();
  const { agents } = useAgents();
  const track = useTrack(id);
  const tracks = useApi(api.tracks, "tracks");
  const name = trackName(id, tracks.data);
  const models = useApi(api.models, "models");
  // A published model (?model=) or a local file / demo agent (?agent=).
  const modelId = params.get("model") ?? (params.get("agent") ? undefined : models.data?.find((m) => m.status === "house")?.id);
  const model = useApi(() => (modelId ? api.model(modelId) : Promise.resolve(undefined)), modelId ?? "");
  const local = agents.find((a) => a.id === params.get("agent")) ?? agents[0]!;
  const agent = modelId
    ? model.data && { id: model.data.id, name: model.data.name, text: model.data.agent, demo: false }
    : models.data
      ? local
      : undefined;
  const [teamId, setTeamId] = useState<string>(TEAMS[0].id);
  const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
  const otherRules = model.data && model.data.rulesId !== R.id ? model.data.rulesId : undefined;
  const run = useRun(otherRules ? undefined : id, agent?.text);
  const [seed, setSeed] = useState<number>(1);

  // Replay the median lap once it's known; until then the first lap that arrives.
  const medianSeed = useMemo(() => run.laps.find((l) => l.status === "finished" && l.steps === run.medianSteps)?.seed, [run.laps, run.medianSteps]);
  useEffect(() => setSeed(medianSeed ?? 1), [medianSeed, agent?.id, id]);
  const lap = run.laps.find((l) => l.seed === seed) ?? run.laps[0];

  return (
    <div className="wrap page">
      <nav className="small muted">
        <Link to="/circuits">Tracks</Link> / {name}
      </nav>
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>{name}</h1>
          <p className="muted">
            {track ? `${km(track.officialLengthM)}, ${track.gates.length} gates` : "…"}, laps run in your browser under rules {R.id}.
          </p>
        </div>
        <div className="row">
          <label className="row small">
            Driver
            <select
              value={modelId ? `model:${modelId}` : `agent:${local.id}`}
              onChange={(e) => {
                const [kind, value] = e.target.value.split(/:(.*)/) as [string, string];
                setParams(kind === "model" ? { model: value } : { agent: value });
              }}
            >
              <optgroup label="Models">
                {models.data
                  ?.filter((m) => m.status !== "archived" || m.id === modelId)
                  .map((m) => (
                    <option key={m.id} value={`model:${m.id}`}>
                      {m.name}
                      {m.status === "house" ? " (house)" : ""}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Local files and demos">
                {agents.map((a) => (
                  <option key={a.id} value={`agent:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
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
            Run a local file
          </Link>
        </div>
      </div>

      {otherRules && (
        <div className="notice">
          This model was trained under {otherRules}, and this build of the dashboard only runs {R.id}. Its published times are on the Models page.
        </div>
      )}
      {(models.error ?? model.error) && <div className="error-box">{models.error ?? model.error}</div>}
      {track && lap?.trace ? (
        <Replay track={track} lap={lap} colors={team.real.colors} />
      ) : (
        <div className="panel panel-pad muted" style={{ minHeight: 320, display: "grid", placeItems: "center" }}>
          {run.phase === "rejected"
            ? "This agent didn't pass the checks. Open it on the run-a-file page to see why."
            : otherRules
              ? "Nothing to run."
              : "Running the first lap in your browser…"}
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
            {model.data && (
              <span className="small muted">
                {model.data.laps.filter((l) => l.trackId === id).length} published laps here
              </span>
            )}
          </div>
          <p className="small muted" style={{ padding: "0 20px 16px" }}>
            A lap ends if any corner of the car leaves the track, the car stops for two seconds, or it runs past {R.timing.maxSteps.toLocaleString()} steps.{" "}
            <Link to="/rules">Full rules</Link>
          </p>
        </section>
        <section className="panel panel-pad stack">
          <h3>About this driver</h3>
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
          {run.summary && (
            <>
              <h3>Car setup</h3>
              <SetupSummary setup={run.summary.setup} />
            </>
          )}
          <p className="small muted">
            {agent?.demo
              ? "A tiny example agent with a handful of hand-placed weights. It's cautious and slow, so there's plenty of time to find."
              : `${agent?.name ?? "…"}, fingerprint ${run.summary?.fingerprint.slice(0, 6) ?? "…"}.`}
            {model.data?.notes ? ` ${model.data.notes}` : ""}
          </p>
          <p className="small muted">
            Every lap above ran in your browser, in the same WebAssembly build the API re-checks with. Each starts from one of three fixed positions: seed 1 is 0.5 m
            left, seed 3 is 0.5 m right.
          </p>
        </section>
      </div>
    </div>
  );
}
