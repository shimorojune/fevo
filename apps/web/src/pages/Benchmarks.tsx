import { Link, useSearchParams } from "react-router-dom";
import { api, useApi } from "../lib/api";
import { lapTime } from "../lib/format";
import { useLive } from "../lib/live";
import { GapBar, LapTime } from "../components/ui";

/** Your models on one track, fastest first. */
export function Benchmarks() {
  const [params, setParams] = useSearchParams();
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const trackId = params.get("track") ?? tracks.data?.[0]?.id;
  const track = tracks.data?.find((t) => t.id === trackId);

  useLive((e) => e.type === "model" && models.reload());

  const ranked = (models.data ?? [])
    .filter((m) => m.status !== "archived" && m.benchmark[trackId ?? ""]?.medianSteps != null)
    .map((m) => ({ m, steps: m.benchmark[trackId!]!.medianSteps! }))
    .sort((a, b) => a.steps - b.steps);
  const best = ranked[0]?.steps;
  const worst = ranked.at(-1)?.steps;

  return (
    <div className="wrap page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Benchmarks</h1>
        <p className="muted">Each model's median clean lap. Archived models are left out.</p>
        {tracks.data && (
          <label className="row small muted">
            Track
            <select value={trackId} onChange={(e) => setParams({ track: e.target.value })}>
              {tracks.data.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {(models.error ?? tracks.error) && <div className="error-box">{models.error ?? tracks.error}</div>}
      {models.data && ranked.length === 0 && <div className="notice">No model has two finished clean laps here yet.</div>}
      {ranked.length > 0 && (
        <ol className="board panel" aria-label={`Benchmarks, ${track?.name}`}>
          {ranked.map(({ m, steps }, i) => (
            <li key={m.id} className={i === 0 ? "lead" : undefined}>
              <span className="pos">{i + 1}</span>
              <span className="driver">
                <span>
                  <Link to={`/circuits/${trackId}?model=${m.id}`} style={{ color: "inherit" }}>
                    {m.name}
                  </Link>
                  {m.status === "house" && <span className="pill house" style={{ marginLeft: 8 }}>House</span>}
                </span>
                <small>
                  {m.kind === "mlp" ? "MLP" : "NEAT"} · {m.parameters.toLocaleString()} params · {m.rulesId} · {m.benchmark[trackId!]!.finished}/{m.benchmark[trackId!]!.total} finished
                </small>
              </span>
              <LapTime steps={steps} lead={i === 0} />
              <GapBar steps={steps} best={best!} worst={worst!} />
            </li>
          ))}
        </ol>
      )}
      {track?.expertLapS != null && (
        <p className="small muted">
          Expert reference lap: <span className="mono">{lapTime(Math.round(track.expertLapS * 60))}</span>
          {best !== undefined && <> · best model is {(((best / 60 - track.expertLapS) / track.expertLapS) * 100).toFixed(1)}% off</>}
        </p>
      )}
    </div>
  );
}
