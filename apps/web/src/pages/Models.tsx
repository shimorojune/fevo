import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi, type ModelStatus, type ModelSummary } from "../lib/api";
import { useLive } from "../lib/live";

const STATUS_LABEL: Record<ModelStatus, string> = { house: "House", candidate: "Candidate", archived: "Archived" };

export function Models() {
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string>();

  // New and changed models arrive live from training.
  useLive((e) => {
    if (e.type !== "model") return;
    models.setData((list) => (list ? [e.model, ...list.filter((m) => m.id !== e.model.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : list));
  });

  const setStatus = (m: ModelSummary, status: ModelStatus) => api.updateModel(m.id, { status }).catch((err: Error) => setError(err.message));
  const shown = models.data?.filter((m) => showArchived || m.status !== "archived");
  const archived = models.data?.filter((m) => m.status === "archived").length ?? 0;

  return (
    <div className="wrap page">
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 8 }}>
          <h1>Models</h1>
          <p className="muted">Median of the clean official laps per track. Click a time to run that model there in your browser.</p>
        </div>
        {archived > 0 && (
          <label className="row small muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show {archived} archived
          </label>
        )}
      </div>

      {(models.error ?? tracks.error ?? error) && <div className="error-box">{models.error ?? tracks.error ?? error}</div>}
      {shown && shown.length === 0 && (
        <div className="panel panel-pad stack" style={{ alignItems: "flex-start" }}>
          <h3>No models yet</h3>
          <p className="muted">
            Publish one from the training Mac with <code>fevo publish winners/model.json</code>. It shows up here as soon as the server has re-run its laps.
          </p>
        </div>
      )}
      {shown && shown.length > 0 && tracks.data && (
        <div className="panel table-wrap">
          <table className="models">
            <thead>
              <tr>
                <th>Model</th>
                <th>Status</th>
                {tracks.data.map((t) => (
                  <th key={t.id}>{t.name}</th>
                ))}
                <th>Published</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={m.id}>
                  <td className="name">
                    {m.name}
                    <small>
                      {m.kind === "mlp" ? "MLP" : "NEAT"} · {m.parameters.toLocaleString()} params · {m.rulesId} · {m.fingerprint.slice(0, 6)}
                    </small>
                    {m.notes && <small>{m.notes}</small>}
                  </td>
                  <td>
                    <span className={`pill ${m.status === "house" ? "house" : ""}`}>{STATUS_LABEL[m.status]}</span>
                  </td>
                  {tracks.data!.map((t) => {
                    const b = m.benchmark[t.id];
                    return (
                      <td key={t.id} className="time">
                        <Link to={`/circuits/${t.id}?model=${m.id}`}>
                          {b?.lapTime ? <span className={`lap-time${m.status === "house" ? " lead" : ""}`}>{b.lapTime}</span> : <span className="muted">Run</span>}
                          {b && (
                            <small>
                              {b.finished}/{b.total} finished
                            </small>
                          )}
                        </Link>
                      </td>
                    );
                  })}
                  <td className="small muted">
                    {new Date(m.createdAt).toLocaleDateString()}
                    {m.runId && (
                      <>
                        <br />
                        <Link to={`/training/${m.runId}`}>Training run</Link>
                      </>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      {m.status !== "house" && (
                        <button className="btn small" onClick={() => void setStatus(m, "house")}>
                          Make house
                        </button>
                      )}
                      {m.status === "archived" ? (
                        <button className="btn small ghost" onClick={() => void setStatus(m, "candidate")}>
                          Restore
                        </button>
                      ) : (
                        <button className="btn small ghost" onClick={() => void setStatus(m, "archived")}>
                          Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
