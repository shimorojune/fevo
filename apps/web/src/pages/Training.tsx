import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MetricsChart } from "../components/MetricsChart";
import { api, useApi, type RunStatus } from "../lib/api";
import { useLive } from "../lib/live";

const STATUS_PILL: Record<RunStatus, string> = { running: "run", done: "ok", failed: "bad", stopped: "" };

function duration(from: string, to: string | null) {
  const s = Math.max(0, ((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000);
  return s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;
}

export function TrainingRuns() {
  const runs = useApi(api.runs, "runs");
  useLive((e) => {
    if (e.type === "run") runs.setData((list) => (list ? [e.run, ...list.filter((r) => r.id !== e.run.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : list));
  });
  return (
    <div className="wrap page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Training</h1>
        <p className="muted">Runs report here from the training Mac as they go.</p>
      </div>
      {runs.error && <div className="error-box">{runs.error}</div>}
      {runs.data && runs.data.length === 0 && <div className="notice">No training runs yet.</div>}
      {runs.data && runs.data.length > 0 && (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Method</th>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/training/${r.id}`}>{r.name}</Link>
                    {r.machine && <span className="small muted"> · {r.machine}</span>}
                  </td>
                  <td className="mono small">{r.method}</td>
                  <td>
                    <span className={`pill ${STATUS_PILL[r.status]}`}>
                      {r.status === "running" && <span className="dot" />} {r.status}
                    </span>
                  </td>
                  <td className="small muted">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="small mono">{duration(r.startedAt, r.endedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TrainingRun() {
  const { id = "" } = useParams();
  const run = useApi(() => api.run(id), id);
  const [picked, setPicked] = useState<string[]>();

  useLive((e) => {
    if (e.type === "metrics" && e.runId === id) {
      run.setData((r) => {
        if (!r) return r;
        const steps = new Set(e.metrics.map((m) => m.step));
        const at = new Date().toISOString();
        return { ...r, metrics: [...r.metrics.filter((m) => !steps.has(m.step)), ...e.metrics.map((m) => ({ ...m, at }))].sort((a, b) => a.step - b.step) };
      });
    }
    if (e.type === "run" && e.run.id === id) run.setData((r) => (r ? { ...r, ...e.run } : r));
    if (e.type === "model" && e.model.runId === id) run.reload();
  });

  const keys = useMemo(() => [...new Set(run.data?.metrics.flatMap((m) => Object.keys(m.values)) ?? [])], [run.data?.metrics]);
  const shown = picked?.filter((k) => keys.includes(k)) ?? keys.slice(0, 1);
  const r = run.data;
  const last = r?.metrics.at(-1);

  return (
    <div className="wrap page">
      <nav className="small muted">
        <Link to="/training">Training</Link> / {r?.name ?? "…"}
      </nav>
      {run.error && <div className="error-box">{run.error}</div>}
      {r && (
        <>
          <div className="spread" style={{ alignItems: "flex-end" }}>
            <div className="stack" style={{ gap: 6 }}>
              <h1>{r.name}</h1>
              <p className="muted">
                {r.method}
                {r.machine ? ` on ${r.machine}` : ""}, started {new Date(r.startedAt).toLocaleString()}, {duration(r.startedAt, r.endedAt)}
                {r.status === "running" ? " so far" : ""}.
              </p>
            </div>
            <div className="row">
              <span className={`pill ${STATUS_PILL[r.status]}`}>
                {r.status === "running" && <span className="dot" />} {r.status}
              </span>
              {r.status === "running" && (
                <button className="btn small ghost" title="Marks the run stopped here. It doesn't stop the trainer." onClick={() => void api.updateRun(r.id, { status: "stopped" })}>
                  Mark stopped
                </button>
              )}
            </div>
          </div>

          <section className="panel panel-pad stack">
            <div className="spread">
              <h3>Progress</h3>
              <span className="small muted">{last ? `step ${last.step}, ${r.metrics.length} reports` : "no reports yet"}</span>
            </div>
            {keys.length > 0 && (
              <div className="row small">
                {keys.map((k) => (
                  <label key={k} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={shown.includes(k)}
                      onChange={(e) => setPicked(e.target.checked ? [...shown, k] : shown.filter((x) => x !== k))}
                    />
                    <span className="mono">{k}</span>
                  </label>
                ))}
              </div>
            )}
            {r.metrics.length > 1 && shown.length > 0 ? (
              <MetricsChart metrics={r.metrics} keys={shown} />
            ) : (
              <p className="muted small">The chart appears after two reports.</p>
            )}
            {last && (
              <dl className="kv" style={{ gridTemplateColumns: `repeat(${Math.min(keys.length, 6)}, auto)` }}>
                {keys.slice(0, 6).map((k) => (
                  <dt key={k}>{k}</dt>
                ))}
                {keys.slice(0, 6).map((k) => (
                  <dd key={k}>{last.values[k]?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "–"}</dd>
                ))}
              </dl>
            )}
          </section>

          <section className="panel panel-pad stack">
            <h3>Models from this run</h3>
            {r.models.length === 0 ? (
              <p className="muted small">None published yet. Candidates appear here as the trainer publishes them.</p>
            ) : (
              <ul className="checks">
                {r.models.map((m) => (
                  <li key={m.id}>
                    <Link to={`/models#${m.id}`}>{m.name}</Link>
                    <span className={`pill ${m.status === "house" ? "house" : ""}`}>{m.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {r.config && (
            <section className="panel panel-pad stack">
              <h3>Config</h3>
              <pre>{JSON.stringify(r.config, null, 2)}</pre>
            </section>
          )}
        </>
      )}
    </div>
  );
}
