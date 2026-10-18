import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CIRCUITS, circuitBrand } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";
import { getLeaderboard, type BoardEntry } from "../lib/api";
import { GapBar, LapTime } from "../components/ui";

export function Leaderboard() {
  const [params, setParams] = useSearchParams();
  const circuitId = params.get("circuit") ?? CIRCUITS[0].id;
  const [entries, setEntries] = useState<BoardEntry[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    setEntries(undefined);
    setError(undefined);
    getLeaderboard(circuitId).then(
      (b) => live && setEntries(b.entries),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [circuitId]);

  const best = entries?.[0]?.medianSteps;
  const worst = entries?.at(-1)?.medianSteps;

  return (
    <div className="wrap page">
      <div className="stack" style={{ gap: 8 }}>
        <h1>Leaderboard</h1>
        <p className="muted">Ranked by the median of three laps from published starts. Only laps our servers have re-run are listed.</p>
        <label className="row small muted">
          Circuit
          <select value={circuitId} onChange={(e) => setParams({ circuit: e.target.value })}>
            {CIRCUITS.map((c) => (
              <option key={c.id} value={c.id}>
                {circuitBrand(c.id).name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="error-box">Couldn't load the leaderboard: {error}</div>}
      {entries && entries.length === 0 && (
        <div className="panel panel-pad stack" style={{ alignItems: "flex-start" }}>
          <h3>No verified times here yet</h3>
          <p className="muted">Be the first: run your agent on this circuit and submit it.</p>
          <Link to={`/upload?circuit=${circuitId}`} className="btn primary">
            Upload an agent
          </Link>
        </div>
      )}
      {entries && entries.length > 0 && (
        <ol className="board panel" aria-label={`Leaderboard, ${circuitBrand(circuitId).name}`}>
          {entries.map((e) => (
            <li key={e.id} className={e.rank === 1 ? "lead" : undefined}>
              <span className="pos">{e.rank}</span>
              <span className="driver">
                <span>{e.driver}</span>
                <small>
                  {e.kind === "mlp" ? "MLP" : "NEAT"} · {e.parameters.toLocaleString()} params · {e.fingerprint.slice(0, 6)}
                </small>
              </span>
              <LapTime steps={e.medianSteps} lead={e.rank === 1} />
              <GapBar steps={e.medianSteps} best={best!} worst={worst!} />
            </li>
          ))}
        </ol>
      )}
      <p className="small muted">
        Simulator {R.simVersion}, rules {R.id}. Ties go to the earlier submission.
      </p>
    </div>
  );
}
