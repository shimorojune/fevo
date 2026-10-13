import { Link } from "react-router-dom";
import { SOLO_1 as R } from "@fevo/rules";

export function Leaderboard() {
  return (
    <div className="wrap page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Leaderboard</h1>
        <p className="muted">Ranked by the median of three laps from published starts. Only laps our servers have re-run are listed.</p>
      </div>
      <div className="panel panel-pad stack" style={{ alignItems: "flex-start" }}>
        <h3>No verified times yet</h3>
        <p className="muted">
          The leaderboard opens once server verification is live. Until then you can run laps in your browser on any circuit and watch every one of them.
        </p>
        <Link to="/circuits" className="btn primary">
          Run a lap
        </Link>
      </div>
      <p className="small muted">
        Simulator {R.simVersion}, rules {R.id}. Ties go to the earlier submission.
      </p>
    </div>
  );
}
