import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LapResult } from "@fevo/sim";
import { getSubmission, submitAgent, type Submission } from "../lib/api";

const NAME_KEY = "fevo.driver";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Send a checked agent to the server, then follow it until the server has re-run its laps. */
export function SubmitPanel({ circuitId, agentText, laps }: { circuitId: string; agentText: string; laps: LapResult[] }) {
  const [name, setName] = useState(savedName);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sub, setSub] = useState<Submission>();
  const [duplicate, setDuplicate] = useState(false);

  // A new file or circuit is a new submission.
  useEffect(() => {
    setSub(undefined);
    setError(undefined);
  }, [agentText, circuitId]);

  useEffect(() => {
    if (sub?.status !== "queued") return;
    const t = setTimeout(() => {
      getSubmission(sub.id).then(setSub, (e: Error) => setError(e.message));
    }, 1000);
    return () => clearTimeout(t);
  }, [sub]);

  const send = async () => {
    setSending(true);
    setError(undefined);
    try {
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        /* storage blocked: the name just isn't remembered */
      }
      const r = await submitAgent(name.trim(), circuitId, agentText, laps);
      setDuplicate(r.duplicate);
      setSub(r.submission);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  if (sub) {
    return (
      <div className="panel-pad stack" style={{ gap: 8 }}>
        {duplicate && <p className="small muted">This network was already submitted here by {sub.driver}; showing that entry.</p>}
        {sub.status === "queued" && <span className="pill run">Our server is re-running your laps</span>}
        {sub.status === "verified" && (
          <span className="row">
            <span className="pill ok">Verified {sub.lapTime}</span>
            <Link to={`/leaderboard?circuit=${sub.circuit}`}>See the leaderboard</Link>
          </span>
        )}
        {sub.status === "unranked" && <span className="pill bad">Verified, but fewer than two laps finished, so it isn't ranked</span>}
        {sub.status === "mismatch" && (
          <div className="error-box stack" style={{ gap: 6 }}>
            <b>The server's laps didn't match your browser's, so this entry isn't ranked.</b>
            <span className="small mono">{sub.detail}</span>
          </div>
        )}
        {sub.status === "failed" && <div className="error-box">Verification failed: {sub.detail}</div>}
      </div>
    );
  }

  return (
    <div className="panel-pad row" style={{ flexWrap: "wrap", gap: 8 }}>
      <input
        aria-label="Driver name"
        placeholder="Driver name"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ height: 40, padding: "0 10px", border: "1px solid var(--line)", borderRadius: 6, minWidth: 0, flex: "1 1 180px" }}
      />
      <button className="btn primary" disabled={sending || !name.trim()} onClick={() => void send()}>
        {sending ? "Submitting" : "Submit to the leaderboard"}
      </button>
      {error && <div className="error-box" style={{ flexBasis: "100%" }}>{error}</div>}
    </div>
  );
}
