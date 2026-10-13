import { Link } from "react-router-dom";
import { CIRCUITS, circuitBrand } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";
import { TrackThumb } from "../components/TrackThumb";
import { km } from "../lib/format";
import { TRACK_IDS } from "../lib/tracks";
import { useAllTracks } from "../lib/useTrack";

export function Circuits() {
  const tracks = useAllTracks(TRACK_IDS);
  return (
    <div className="wrap page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Circuits</h1>
        <p className="muted">
          Times only compare within the same rules version. The current version is {R.id}.
        </p>
      </div>
      <div className="grid-cards">
        {CIRCUITS.map((c) => {
          const t = tracks[c.id];
          const b = circuitBrand(c.id);
          return (
            <article key={c.id} className="panel panel-pad stack">
              <TrackThumb track={t} w={300} h={170} stroke={5} />
              <div>
                <h3>{b.name}</h3>
                <p className="small muted">{b.location}</p>
              </div>
              <dl className="kv">
                <dt>Length</dt>
                <dt>Width</dt>
                <dt>Gates</dt>
                <dd>{t ? km(t.officialLengthM) : "…"}</dd>
                <dd>{t ? `${Math.min(...t.widthLeft.map((l, i) => l + t.widthRight[i]!)).toFixed(0)}–${Math.max(...t.widthLeft.map((l, i) => l + t.widthRight[i]!)).toFixed(0)} m` : "…"}</dd>
                <dd>{t?.gates.length ?? "…"}</dd>
              </dl>
              <p className="small muted">Nobody has set a time here yet. The first verified lap takes P1.</p>
              <div className="row">
                <Link to={`/circuits/${c.id}`} className="btn primary">
                  Run a lap
                </Link>
                <Link to="/leaderboard" className="btn">
                  Leaderboard
                </Link>
              </div>
            </article>
          );
        })}
      </div>
      <p className="small muted">New circuits arrive with each season, under a new rules version.</p>
    </div>
  );
}
