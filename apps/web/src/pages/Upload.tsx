import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CIRCUITS, circuitBrand } from "@fevo/branding";
import { MAX_FILE_BYTES } from "@fevo/agent-format";
import { SOLO_1 as R } from "@fevo/rules";
import { LapsTable } from "../components/Laps";
import { useAgents, type Agent } from "../lib/agents";
import { lapTime } from "../lib/format";
import { useRun } from "../sim/useRun";

export function Upload() {
  const [params, setParams] = useSearchParams();
  const circuitId = params.get("circuit") ?? "spielberg";
  const { add } = useAgents();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<Agent>();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useRun(agent ? circuitId : undefined, agent?.text);

  const take = async (file: File | undefined) => {
    if (!file) return;
    const text = file.size > MAX_FILE_BYTES * 2 ? "x".repeat(MAX_FILE_BYTES + 1) : await file.text();
    setAgent(add(file.name, text));
  };

  const check = (label: string, state: "ok" | "bad" | "run" | "wait", detail?: string) => (
    <li>
      <span>{label}</span>
      <span className={`pill ${state === "ok" ? "ok" : state === "bad" ? "bad" : state === "run" ? "run" : ""}`}>
        {state === "ok" ? detail ?? "Passed" : state === "bad" ? detail ?? "Failed" : state === "run" ? "Checking" : "Waiting"}
      </span>
    </li>
  );

  const checked = run.phase !== "idle" && run.phase !== "checking";
  const passed = run.summary !== undefined;
  const first = run.laps[0];

  return (
    <div className="wrap page" style={{ maxWidth: 960 }}>
      <div className="stack" style={{ gap: 8 }}>
        <h1>Upload an agent</h1>
        <div className="row small muted">
          <label className="row">
            Circuit
            <select value={circuitId} onChange={(e) => setParams({ circuit: e.target.value })}>
              {CIRCUITS.map((c) => (
                <option key={c.id} value={c.id}>
                  {circuitBrand(c.id).name}
                </option>
              ))}
            </select>
          </label>
          <span>
            Rules {R.id}, Open JSON class. Need something to start from? Try the demo agents on any <Link to="/circuits">circuit</Link>, or read the{" "}
            <Link to="/rules#agent-spec">agent spec</Link>.
          </span>
        </div>
      </div>

      <div
        className={`dropzone${over ? " over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
      >
        <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => void take(e.target.files?.[0])} />
        <h3>{over ? "Let go to check it" : agent ? agent.name : "Drop your agent's JSON file here"}</h3>
        <p className="small muted">{agent ? "Drop another file or click to choose one" : `or click to choose one, up to ${MAX_FILE_BYTES / 1024} KB`}</p>
      </div>

      {agent && (
        <section className="panel panel-pad stack">
          <div className="spread">
            <h3>Checking your agent</h3>
            {run.summary && <span className="small muted mono">fingerprint {run.summary.fingerprint.slice(0, 6)}</span>}
          </div>
          <ul className="checks">
            {check("Reads as JSON, right shape, no loops, 15 inputs and 2 outputs", !checked ? "run" : passed ? "ok" : "bad", run.checkMs !== undefined && passed ? `${run.checkMs.toFixed(0)} ms` : undefined)}
            {check("First step runs and outputs are numbers", !passed ? "wait" : first ? (first.status === "error" && first.steps <= 1 ? "bad" : "ok") : "run")}
            {R.seeds.map((_, s) => {
              const l = run.laps.find((x) => x.seed === s);
              return (
                <li key={s}>
                  <span>Lap from seed {s + 1}</span>
                  {l ? (
                    <span className={`pill ${l.status === "finished" ? "ok" : "bad"}`}>{l.status === "finished" ? lapTime(l.steps) : `${l.status} at gate ${l.gatesPassed} of ${l.gateCount}`}</span>
                  ) : (
                    <span className={`pill ${passed ? "run" : ""}`}>{passed ? "Running" : "Waiting"}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {run.errors?.map((e, i) => (
            <div key={i} className="error-box stack" style={{ gap: 6 }}>
              <b>{e.message}</b>
              {e.hint && <span className="small">{e.hint}</span>}
            </div>
          ))}
          {run.phase === "failed" && <div className="error-box">The simulator stopped unexpectedly: {run.message}</div>}

          {run.summary && (
            <dl className="kv">
              <dt>Type</dt>
              <dt>Nodes</dt>
              <dt>Parameters</dt>
              <dd>{run.summary.kind === "mlp" ? "MLP" : "NEAT genome"}</dd>
              <dd>{run.summary.nodes}</dd>
              <dd>{run.summary.parameters}</dd>
            </dl>
          )}
        </section>
      )}

      {run.laps.length > 0 && (
        <section className="panel">
          <div className="panel-pad spread">
            <div className="stat">
              <div className="k">Median lap</div>
              <div className="v">{run.medianSteps !== null ? lapTime(run.medianSteps) : run.phase === "done" ? "Not ranked" : "…"}</div>
            </div>
            <button className="btn primary" onClick={() => agent && navigate(`/circuits/${circuitId}?agent=${agent.id}`)}>
              Open the replay
            </button>
          </div>
          <LapsTable laps={run.laps} medianSteps={run.medianSteps} />
          <p className="small muted" style={{ padding: "12px 20px 16px" }}>
            {run.phase === "done" && !run.ranked
              ? "An agent needs two finished laps to be ranked. Open the replay to see where it went wrong."
              : "Submitting to the leaderboard opens once our servers can re-run laps; they'll repeat these exact laps with the same build."}
          </p>
        </section>
      )}
    </div>
  );
}
