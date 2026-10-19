import { useLayoutEffect, useRef, useState } from "react";
import type { Series } from "@/lib/series";
import { STEP_M } from "@/lib/series";

export type TraceKey = "speed" | "gap" | "throttle" | "brake" | "steer";
export const TRACES: { key: TraceKey; title: string }[] = [
  { key: "speed", title: "Speed" },
  { key: "gap", title: "Gap" },
  { key: "throttle", title: "Throttle" },
  { key: "brake", title: "Brake" },
  { key: "steer", title: "Steer" },
];

const LM = 46;
const RM = 8;

function niceTicks(lo: number, hi: number) {
  const span = hi - lo;
  const st = span > 20 ? 10 : span > 8 ? 5 : span > 4 ? 2 : span > 2 ? 1 : 0.5;
  const t: number[] = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) t.push(+v.toFixed(2));
  return t;
}

/**
 * The dock under the track: the traces you've switched on, against distance, both drivers
 * overlaid. Hover reads values off every trace at once; click jumps the replay there.
 */
export function Traces({ s, on, corners, names, at, onHover, onSeek }: { s: Series; on: TraceKey[]; corners: number[]; names: [string, string | null]; at: number; onHover: (k: number | null) => void; onSeek: (k: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const X = (d: number) => LM + (d / s.length) * (W - LM - RM);
  const k = hover ?? at;
  const kAt = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(s.d.length - 1, Math.round((((x - LM) / (W - LM - RM)) * s.length) / STEP_M)));
  };
  const gap = s.gap;
  const gLo = gap ? Math.min(0, ...gap) - 0.2 : -1;
  const gHi = gap ? Math.max(0, ...gap) + 0.2 : 1;
  const vTop = Math.max(100, Math.ceil(Math.max(...s.speedA, ...(s.speedB ?? [])) / 50) * 50);
  const charts = [
    { key: "speed", title: "Speed", unit: "km/h", h: 120, lo: 0, hi: vTop, ticks: Array.from({ length: Math.floor(vTop / 100) + 1 }, (_, i) => i * 100), a: s.speedA, b: s.speedB },
    { key: "gap", title: "Gap", unit: names[1] ? `s, ${names[1]} behind ${names[0]}` : "needs a ghost", h: 64, lo: gLo, hi: gHi, ticks: null, a: null, b: null },
    { key: "throttle", title: "Throttle", unit: "%", h: 52, lo: 0, hi: 100, ticks: [0, 100], a: s.throttleA, b: s.throttleB },
    { key: "brake", title: "Brake", unit: "%", h: 40, lo: 0, hi: 100, ticks: [0, 100], a: s.brakeA, b: s.brakeB },
    { key: "steer", title: "Steer", unit: "left − / right +", h: 52, lo: -1, hi: 1, ticks: [-1, 0, 1], a: s.steerA, b: s.steerB },
  ].filter((c) => on.includes(c.key as TraceKey) && (c.key !== "gap" || gap));
  const cornerM = corners.map((f, i) => ({ d: f * s.length, n: i + 1 }));
  const fmtGap = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(3)} s`;
  const pedal = (th: number[] | null, br: number[] | null) => (th && br ? (br[k]! > 0 ? `brake ${Math.round(br[k]!)}%` : `${Math.round(th[k]!)}%`) : "");
  return (
    <div ref={host} className="relative">
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 z-10 min-w-[190px] rounded-sm border border-border bg-popover px-2.5 py-[7px] text-xs shadow-[0_6px_20px_rgba(0,0,0,.1)] animate-fade" style={{ left: Math.max(8, Math.min(W - 210, X(s.d[hover]!) + 14)) }}>
          <div className="mb-1 flex justify-between gap-3">
            <span className="text-muted-foreground">{Math.round(s.d[hover]!)} m</span>
            {gap && <span className="font-mono">{fmtGap(gap[hover]!)}</span>}
          </div>
          <div className="flex justify-between gap-3">
            <span><i className="mr-1.5 inline-block h-[3px] w-2.5 rounded-xs bg-driver-a align-[3px]" />{names[0]}</span>
            <span className="font-mono">{Math.round(s.speedA[hover]!)} km/h · {pedal(s.throttleA, s.brakeA)}</span>
          </div>
          {s.speedB && (
            <div className="flex justify-between gap-3">
              <span><i className="mr-1.5 inline-block h-[3px] w-2.5 rounded-xs bg-driver-b align-[3px]" />{names[1]}</span>
              <span className="font-mono">{Math.round(s.speedB[hover]!)} km/h · {pedal(s.throttleB, s.brakeB)}</span>
            </div>
          )}
        </div>
      )}
      {charts.map((c, idx) => {
        const first = idx === 0;
        const last = idx === charts.length - 1;
        const top = first ? 26 : 18;
        const H = top + c.h + (last ? 18 : 4);
        const Y = (v: number) => top + c.h - ((v - c.lo) / (c.hi - c.lo)) * c.h;
        const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${X(s.d[i]!).toFixed(1)} ${Y(v).toFixed(1)}`).join("");
        const ticks = c.ticks ?? niceTicks(c.lo, c.hi);
        const z = Y(0);
        const dl = c.key === "gap" && gap ? path(gap) : "";
        const area = dl && `${dl}L${X(s.d[s.d.length - 1]!)} ${z} L${X(0)} ${z}Z`;
        return (
          <div key={c.key} className="chart animate-rise">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${c.title} against distance`} onPointerMove={(e) => { const i = kAt(e); setHover(i); onHover(i); }} onPointerLeave={() => { setHover(null); onHover(null); }} onPointerDown={(e) => onSeek(kAt(e))}>
              <text className="t" x={0} y={top - 8}>{c.title}</text>
              <text className="u" x={c.title.length * 6.6 + 8} y={top - 8}>{c.unit}</text>
              {ticks.map((v) => (
                <g key={v}>
                  <line className="gl" x1={LM} x2={W - RM} y1={Y(v)} y2={Y(v)} />
                  <text className="ax" x={LM - 6} y={Y(v) + 3.5} textAnchor="end">{v}</text>
                </g>
              ))}
              {cornerM.map((cn) => (
                <g key={cn.n}>
                  <line className="corner" x1={X(cn.d)} x2={X(cn.d)} y1={top} y2={top + c.h} />
                  {first && <text className="cl" x={X(cn.d)} y={top - 8} textAnchor="middle">T{cn.n}</text>}
                </g>
              ))}
              {c.key === "gap" ? (
                <>
                  <defs>
                    <clipPath id="gap-up"><rect x={0} y={0} width={W} height={z} /></clipPath>
                    <clipPath id="gap-down"><rect x={0} y={z} width={W} height={H} /></clipPath>
                  </defs>
                  <path className="fa" clipPath="url(#gap-up)" d={area} />
                  <path className="fb" clipPath="url(#gap-down)" d={area} />
                  <line className="zero" x1={LM} x2={W - RM} y1={z} y2={z} />
                  <path d={dl} fill="none" stroke="var(--foreground)" strokeWidth={1.4} />
                </>
              ) : (
                <>
                  {c.b && <path className="sb" d={path(c.b)} />}
                  {c.a && <path className="sa" d={path(c.a)} />}
                </>
              )}
              {last && Array.from({ length: Math.floor(s.length / 500) + 1 }, (_, i) => i * 500).map((d) => (
                <text key={d} className="ax" x={X(d)} y={H - 4} textAnchor="middle">{d === 0 ? "0 m" : d}</text>
              ))}
              <line className="cross" x1={X(s.d[k]!)} x2={X(s.d[k]!)} y1={top} y2={top + c.h} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
