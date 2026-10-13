import { Link } from "react-router-dom";
import { CIRCUITS, circuitBrand } from "@fevo/branding";
import { SOLO_1 as R } from "@fevo/rules";
import { TrackThumb } from "../components/TrackThumb";
import { km } from "../lib/format";
import { TRACK_IDS } from "../lib/tracks";
import { useAllTracks } from "../lib/useTrack";

const STEPS = [
  ["Pick a circuit", "Each circuit is tied to a rules version, so every time on it compares fairly."],
  ["Drop in your JSON", "A NEAT genome or a small MLP. We check its shape in a few seconds."],
  ["Watch three laps", "Each starts from a slightly different published position. The middle time counts."],
  ["We re-run it, then rank it", "Our servers repeat the laps with the same build. Matching times go on the board."],
];

export function Home() {
  const tracks = useAllTracks(TRACK_IDS);
  return (
    <>
      <section className="wrap" style={{ padding: "72px 28px 64px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1280 }}>
        <h1 style={{ fontSize: "clamp(40px, 5vw, 60px)", maxWidth: "13em", letterSpacing: "-0.035em" }}>Upload a neural network. Get a lap time you can trust.</h1>
        <p style={{ fontSize: 19, color: "var(--fg-2)", maxWidth: "32em" }}>
          fevo drives your agent around real Formula 1 circuits, measured to scale, on the same simulator and rules as everyone else. Then it shows you exactly
          how the lap went.
        </p>
        <div className="row" style={{ gap: 20 }}>
          <Link to="/circuits/spielberg" className="btn primary big">
            Watch a demo lap
          </Link>
          <Link to="/upload" style={{ fontWeight: 600, fontSize: 17 }}>
            Upload your own agent
          </Link>
        </div>
        <p className="small muted">No account, no Python, no install. Example agents are included.</p>
      </section>

      <section style={{ background: "var(--panel)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap" style={{ padding: "64px 28px", display: "flex", flexDirection: "column", gap: 32 }}>
          <h2 style={{ fontSize: 32 }}>How a lap gets its time</h2>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 28 }}>
            {STEPS.map(([t, d], i) => (
              <li key={t} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 16, borderTop: `3px solid ${i === 3 ? "var(--blue)" : "var(--fg)"}` }}>
                <span className="mono muted">{i + 1}</span>
                <b style={{ fontSize: 18 }}>{t}</b>
                <span style={{ color: "var(--fg-2)" }}>{d}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="wrap page">
        <div className="spread">
          <h2 style={{ fontSize: 32 }}>Circuits this season</h2>
          <Link to="/circuits" style={{ fontWeight: 600 }}>
            All circuits
          </Link>
        </div>
        <div className="panel table-wrap">
          <table style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Circuit</th>
                <th>Length</th>
                <th>Gates</th>
                <th>Fastest lap</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {CIRCUITS.map((c) => {
                const t = tracks[c.id];
                const b = circuitBrand(c.id);
                return (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 20 }}>
                      <span className="row" style={{ gap: 14 }}>
                        <TrackThumb track={t} />
                        <span>
                          <b>{b.name}</b>
                          <br />
                          <span className="small muted">{b.location}</span>
                        </span>
                      </span>
                    </td>
                    <td className="mono">{t ? km(t.officialLengthM) : "…"}</td>
                    <td className="mono">{t?.gates.length ?? "…"}</td>
                    <td className="muted">Open</td>
                    <td style={{ textAlign: "right", paddingRight: 20 }}>
                      <Link to={`/circuits/${c.id}`} className="btn small">
                        Run a lap
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ background: "var(--panel)", borderTop: "1px solid var(--line)" }}>
        <div className="wrap" style={{ padding: "64px 28px", display: "grid", gap: 32, gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))" }}>
          <div className="stack">
            <h2 style={{ fontSize: 28 }}>Fifteen numbers in, two numbers out</h2>
            <p style={{ color: "var(--fg-2)" }}>
              Every sixtieth of a second your agent gets eleven distances to the track edge, plus its speed, how far round the lap it is, how far off the centre line
              it is and which way it's pointing. It answers with steering and throttle, each between −1 and 1.
            </p>
            <p style={{ color: "var(--fg-2)" }}>Upload a NEAT genome with any feed-forward shape, or a plain MLP. Trained it in Python? Export JSON and upload it here.</p>
            <Link to="/rules#agent-spec" style={{ fontWeight: 600 }}>
              Read the agent spec
            </Link>
          </div>
          <div className="stack">
            <h2 style={{ fontSize: 28 }}>Why the times hold up</h2>
            <p style={{ color: "var(--fg-2)" }}>
              <b>One simulator.</b> Physics, sensors and your network run in one WebAssembly build, bit-identical in every browser and on our servers. It steps at a
              fixed {R.timing.agentHz} Hz, so a fast or slow computer changes nothing.
            </p>
            <p style={{ color: "var(--fg-2)" }}>
              <b>Real scale.</b> Circuits come from measured track data, metre for metre, and the car is a {R.car.lengthM} × {R.car.widthM} m 2026-spec car.
            </p>
            <p style={{ color: "var(--fg-2)" }}>
              <b>Three starts, middle time counts.</b> One lucky line can't win.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
