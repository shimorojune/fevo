import { Link } from "react-router-dom";
import { TrackThumb } from "../components/TrackThumb";
import { api, useApi } from "../lib/api";
import { km, lapTime } from "../lib/format";
import { useAllTracks } from "../lib/useTrack";

export function Circuits() {
  const list = useApi(api.tracks, "tracks");
  const models = useApi(api.models, "models");
  const tracks = useAllTracks(list.data?.map((t) => t.id) ?? []);
  const house = models.data?.find((m) => m.status === "house");

  return (
    <div className="wrap page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Tracks</h1>
        <p className="muted">Every track in the database. Training adds more with a publish.</p>
      </div>
      {list.error && <div className="error-box">{list.error}</div>}
      <div className="grid-cards">
        {list.data?.map((s) => {
          const t = tracks[s.id];
          const best = house?.benchmark[s.id];
          return (
            <article key={s.id} className="panel panel-pad stack">
              <TrackThumb track={t} w={300} h={170} stroke={5} />
              <div className="spread">
                <h3>{s.name}</h3>
                <span className="row" style={{ gap: 6 }}>
                  <span className="pill">{s.kind}</span>
                  {s.heldOut && <span className="pill run">held out</span>}
                </span>
              </div>
              <dl className="kv">
                <dt>Length</dt>
                <dt>Gates</dt>
                <dt>Expert lap</dt>
                <dd>{km(s.lengthM)}</dd>
                <dd>{t?.gates.length ?? "…"}</dd>
                <dd>{s.expertLapS != null ? lapTime(Math.round(s.expertLapS * 60)) : "–"}</dd>
              </dl>
              <p className="small muted">
                {house ? (best?.lapTime ? `House driver ${house.name}: ${best.lapTime}, ${best.finished}/${best.total} laps finished.` : `No published laps here for ${house.name}.`) : "No house driver yet."}
              </p>
              <div className="row">
                <Link to={`/circuits/${s.id}`} className="btn primary">
                  Run a lap
                </Link>
                <Link to={`/benchmarks?track=${s.id}`} className="btn">
                  Benchmarks
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
