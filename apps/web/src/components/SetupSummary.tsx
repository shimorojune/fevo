import { SOLO_1 as R } from "@fevo/rules";

/** The agent's car setup next to the default, knob by knob. */
export function SetupSummary({ setup }: { setup: number[] }) {
  if (!setup.length) return null;
  return (
    <dl className="kv" style={{ gridTemplateColumns: "repeat(2, auto)" }}>
      {R.setup.map((k, i) => (
        <div key={k.id} style={{ display: "contents" }}>
          <dt>{k.label}</dt>
          <dd>
            {setup[i]}
            {setup[i] === k.default ? <span className="muted"> (default)</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
