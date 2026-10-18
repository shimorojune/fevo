import { SOLO_1 as R } from "@fevo/rules";

const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(1);

export function Rules() {
  const c = R.car;
  const rows: [string, string][] = [
    ["Length × width", `${c.lengthM} × ${c.widthM} m`],
    ["Wheelbase", `${c.wheelbaseM} m`],
    ["Mass with driver", `${c.massKg} kg`],
    ["Power", `${c.powerW / 1000} kW`],
    ["Maximum steering angle", `±${deg(c.maxSteerRad)}°`],
    ["Tyre grip front / rear", `μ ${c.tyreMuFront} / ${c.tyreMuRear}`],
    ["Drag / downforce area", `${c.dragAreaM2} / ${c.downforceAreaM2} m²`],
  ];
  return (
    <div className="wrap page" style={{ maxWidth: 880 }}>
      <div className="stack" style={{ gap: 8 }}>
        <h1>Rules, {R.id}</h1>
        <p className="muted">
          Simulator {R.simVersion}. Everything your agent sees, everything it controls, and exactly how a lap is timed. Every number on this page is read from the
          simulator build. If anything here disagrees with the simulator, the simulator is wrong and we'll fix it.
        </p>
      </div>

      <section className="panel panel-pad stack">
        <h2>1. Car</h2>
        <p className="muted">
          Top-down and two-dimensional. A dynamic single-track model with grip-limited tyres, downforce and drag. Every car is identical; liveries are cosmetic.
          No tyre wear, fuel or slipstream in {R.id}.
        </p>
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="muted">{k}</td>
                <td className="mono">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel panel-pad stack" id="setup">
        <h2>Car setup</h2>
        <p className="muted">
          An agent file may include a <code>"setup"</code> block. Anything left out uses the default. Each knob moves the car along a real trade-off; none of
          them adds free speed. The setup is part of the agent's fingerprint and is shown with every replay.
        </p>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Range</th>
              <th>Default</th>
              <th>What it does</th>
            </tr>
          </thead>
          <tbody>
            {R.setup.map((k) => (
              <tr key={k.id}>
                <td className="mono">{k.id}</td>
                <td className="mono">
                  {k.min} to {k.max}
                </td>
                <td className="mono">{k.default}</td>
                <td>{k.help}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre>{`"setup": { "wing": 0.15, "aeroBalance": 0.44, "antiRollBalance": -0.3, "brakeBias": 0.57 }`}</pre>
      </section>

      <section className="panel panel-pad stack">
        <h2>2. Track and lap</h2>
        <p>
          <b>Timing.</b> The simulator advances in fixed steps of 1/{R.timing.agentHz} s ({R.timing.physicsSubsteps} physics substeps each), whatever the frame
          rate. Lap time is steps divided by {R.timing.agentHz}.
        </p>
        <p>
          <b>Leaving the track.</b> If any corner of the car crosses the outer or inner edge, the lap ends as a crash.
        </p>
        <p>
          <b>Gates.</b> Lines across the track, about every {R.track.gateSpacingM} m, that must be crossed in order. A lap counts once every gate is crossed and the
          car reaches the start line. Laps start from a standstill on the start line.
        </p>
        <p>
          <b>Stopping.</b> Speed below {R.timing.stopSpeedMps} m/s for {R.timing.stopSteps} steps in a row ends the lap as stopped.
        </p>
        <p>
          <b>Time limit.</b> A lap still running after {R.timing.maxSteps.toLocaleString()} steps ends as timed out.
        </p>
      </section>

      <section className="panel panel-pad stack" id="agent-spec">
        <h2>3. What the agent sees</h2>
        <p className="muted">Fifteen numbers every step, always in this order.</p>
        <table>
          <thead>
            <tr>
              <th>Index</th>
              <th>Meaning</th>
              <th>Range</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="mono">0–{R.sensors.rayCount - 1}</td>
              <td>
                Distance to the track edge along each ray, divided by {R.sensors.rayLengthM} m. {R.sensors.rayCount} rays spread evenly from 90° left to 90° right.
              </td>
              <td className="mono">0 to 1</td>
            </tr>
            <tr>
              <td className="mono">{R.sensors.rayCount}</td>
              <td>Forward speed divided by {R.sensors.speedNormMps} m/s</td>
              <td className="mono">0 to 1</td>
            </tr>
            <tr>
              <td className="mono">{R.sensors.rayCount + 1}</td>
              <td>Gates crossed divided by total gates</td>
              <td className="mono">0 to 1</td>
            </tr>
            <tr>
              <td className="mono">{R.sensors.rayCount + 2}</td>
              <td>Distance from the centre line divided by half the track width, positive to the right</td>
              <td className="mono">−1 to 1</td>
            </tr>
            <tr>
              <td className="mono">{R.sensors.rayCount + 3}</td>
              <td>Angle between the car and the track direction divided by π, positive when pointing right</td>
              <td className="mono">−1 to 1</td>
            </tr>
          </tbody>
        </table>
        <h2>4. What the agent controls</h2>
        <p>
          <span className="mono">0 steer</span>: −1 is full left, 1 is full right. <span className="mono">1 throttle</span>: 1 is full power, negative values brake.
          Values outside −1 to 1 are clamped. If either output is NaN or infinite, the lap ends with an error. There's no traction control.
        </p>
      </section>

      <section className="panel panel-pad stack">
        <h2>5. Scoring</h2>
        <p>
          <b>Three starts.</b> Each official lap begins from a published seed that nudges the start position and heading:{" "}
          {R.seeds.map((s, i) => `seed ${i + 1} ${s.lateralM >= 0 ? "+" : ""}${s.lateralM} m, ${s.headingRad >= 0 ? "+" : ""}${s.headingRad} rad`).join("; ")}.
        </p>
        <p>
          <b>The middle time counts.</b> A lap that doesn't finish counts as slower than any that does, so two finished laps are needed to be ranked.
        </p>
        <p>
          <b>Re-run before publishing.</b> <code>fevo publish</code> runs the laps on the training Mac; the API runs the clean ones again with the same build
          and refuses the model unless every step count and lap hash matches.
        </p>
      </section>

      <section className="panel panel-pad stack">
        <h2>6. File formats</h2>
        <p>One JSON file of up to 500 KB: a NEAT genome (neat-python 2.0 semantics, any feed-forward shape) or an MLP.</p>
        <pre>{`{
  "inputKeys": [-1, -2, ..., -15],
  "outputKeys": [0, 1],
  "nodes": [
    { "id": 0, "type": "output", "bias": 0.1, "response": 1, "activation": "tanh", "aggregation": "sum" }
  ],
  "connections": [ { "in": -1, "out": 0, "weight": 0.8, "enabled": true } ]
}`}</pre>
        <pre>{`{
  "layers": [15, 32, 2],
  "activation": "tanh",
  "weights": [[ /* 32 × 15, row-major [out][in] */ ], [ /* 2 × 32 */ ]],
  "biases": [[ /* 32 */ ], [ /* 2 */ ]]
}`}</pre>
      </section>
    </div>
  );
}
