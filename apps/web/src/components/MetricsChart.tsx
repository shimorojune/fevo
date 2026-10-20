import type { Metric } from "../lib/api";

const COLORS = ["var(--accent)", "var(--info)", "var(--ok)", "var(--fast)", "var(--bad)", "var(--fg-2)"];

/** One line per chosen metric over training steps, each scaled to its own range. */
export function MetricsChart({ metrics, keys }: { metrics: Metric[]; keys: string[] }) {
  const W = 800;
  const H = 260;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const steps = metrics.map((m) => m.step);
  const x0 = Math.min(...steps);
  const x1 = Math.max(...steps, x0 + 1);
  const X = (s: number) => pad.l + ((s - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const single = keys.length === 1;

  const lines = keys.map((k, i) => {
    const pts = metrics.filter((m) => typeof m.values[k] === "number").map((m) => [m.step, m.values[k]!] as const);
    const vs = pts.map(([, v]) => v);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs, lo + 1e-9);
    const Y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
    return { k, color: COLORS[i % COLORS.length]!, lo, hi, d: pts.map(([s, v], j) => `${j ? "L" : "M"}${X(s).toFixed(1)},${Y(v).toFixed(1)}`).join("") };
  });
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));

  return (
    <div className="stack" style={{ gap: 8 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Training metrics: ${keys.join(", ")}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = pad.t + f * (H - pad.t - pad.b);
          return <line key={f} className="grid" x1={pad.l} x2={W - pad.r} y1={y} y2={y} />;
        })}
        {single && lines[0] && (
          <>
            <text x={pad.l - 6} y={pad.t + 4} textAnchor="end">
              {fmt(lines[0].hi)}
            </text>
            <text x={pad.l - 6} y={H - pad.b + 4} textAnchor="end">
              {fmt(lines[0].lo)}
            </text>
          </>
        )}
        <text x={pad.l} y={H - 8}>
          step {x0}
        </text>
        <text x={W - pad.r} y={H - 8} textAnchor="end">
          {x1}
        </text>
        {lines.map((l) => (
          <path key={l.k} d={l.d} fill="none" stroke={l.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="legend">
        {lines.map((l) => (
          <span key={l.k}>
            <i style={{ background: l.color }} />
            {l.k} {fmt(l.lo)} to {fmt(l.hi)}
          </span>
        ))}
      </div>
    </div>
  );
}
