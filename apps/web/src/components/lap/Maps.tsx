import { useMemo, useState } from "react";
import type { LapTrace } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";
import { Segmented } from "@/components/ui/segmented";
import { HZ } from "@/lib/format";
import { miniBounds, sample, type Colours, type LapTimes } from "@/lib/lap";
import { PLASMA, plasma, type Series } from "@/lib/series";
import { F1Key } from "./Sectors";

type MapKind = "speed" | "mini" | "dominance";
const MW = 380;
const PAD = 26;
const F1VAR = { p: "var(--sector-purple)", g: "var(--sector-green)", y: "var(--sector-yellow)" };

/** Speed, mini-sector and dominance maps of the lap, in the inspector. */
export function Maps({ track, s, a, b, names, times, col, at, cornerFractions }: { track: TrackFile; s: Series; a: LapTrace; b?: LapTrace; names: [string, string | null]; times: LapTimes; col: Colours; at: number; cornerFractions: number[] }) {
  const [kind, setKind] = useState<MapKind>("speed");
  const fit = useMemo(() => {
    const c = track.centerline;
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let i = 0; i < c.length; i += 2) {
      mnx = Math.min(mnx, c[i]!);
      mxx = Math.max(mxx, c[i]!);
      mny = Math.min(mny, c[i + 1]!);
      mxy = Math.max(mxy, c[i + 1]!);
    }
    const sc = (MW - 2 * PAD) / Math.max(mxx - mnx, mxy - mny);
    const MH = Math.round((mxy - mny) * sc + 2 * PAD);
    return { MH, P: (x: number, y: number): [number, number] => [PAD + (x - mnx) * sc, MH - PAD - (y - mny) * sc] };
  }, [track]);
  const { P, MH } = fit;
  const pts = useMemo(() => s.fa.map((f) => P(sample(a.x, f), sample(a.y, f))), [s, a, P]);
  const line = (from: number, to: number) => pts.slice(from, to + 1).map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const start = P(track.centerline[2 * track.gates[0]!]!, track.centerline[2 * track.gates[0]! + 1]!);

  const speed = useMemo(() => {
    const lo = Math.min(...s.speedA);
    const hi = Math.max(...s.speedA);
    return { lo, hi, segs: pts.slice(1).map((p, k) => ({ p0: pts[k]!, p1: p, c: plasma((s.speedA[k + 1]! - lo) / (hi - lo || 1)) })) };
  }, [pts, s]);

  const minis = useMemo(() => {
    const c = track.centerline;
    const n = track.widthLeft.length;
    const bIdx = miniBounds(track.gates.length).map((k) => track.gates[k]!);
    const s0 = [track.gates[0]!, ...bIdx];
    const s1 = [...bIdx, track.gates[0]! + n];
    return s0.map((a0, k) => {
      let d = "";
      for (let i = a0; i <= s1[k]!; i += 3) {
        const q = i % n;
        const [x, y] = P(c[2 * q]!, c[2 * q + 1]!);
        d += `${d ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      return d;
    });
  }, [track, P]);

  const dominance = useMemo(() => {
    if (!s.fb) return null;
    const N = 25;
    let wa = 0;
    const segs = Array.from({ length: N }, (_, m) => {
      const k0 = Math.round((m / N) * (s.d.length - 1));
      const k1 = Math.round(((m + 1) / N) * (s.d.length - 1));
      const tA = (s.fa[k1]! - s.fa[k0]!) / HZ;
      const tB = (s.fb![k1]! - s.fb![k0]!) / HZ;
      if (tA <= tB) wa++;
      return { d: line(k0, k1), a: tA <= tB, tA, tB };
    });
    return { segs, wa, wb: N - wa };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, pts]);

  const markA = pts[at];
  const markB = b && s.fb ? P(sample(b.x, s.fb[at]!), sample(b.y, s.fb[at]!)) : null;
  const items = [
    { value: "speed" as const, label: "Speed" },
    { value: "mini" as const, label: "Mini sectors" },
    ...(dominance ? [{ value: "dominance" as const, label: "Dominance" }] : []),
  ];

  return (
    <>
      <Segmented<MapKind> label="Map" value={kind} onChange={setKind} items={items} className="self-start" />
      <div key={kind} className="flex animate-rise flex-col gap-1.5">
        {kind === "speed" && (
          <>
            <p className="m-0 text-xs text-muted-foreground">{names[0]}'s line, coloured by speed.</p>
            <svg viewBox={`0 0 ${MW} ${MH}`} className="block h-auto w-full" role="img" aria-label="Track map coloured by speed">
              <path d={line(0, pts.length - 1)} fill="none" stroke="var(--border)" strokeWidth={12} strokeLinejoin="round" />
              {speed.segs.map((g, k) => (
                <line key={k} x1={g.p0[0]} y1={g.p0[1]} x2={g.p1[0]} y2={g.p1[1]} stroke={g.c} strokeWidth={5} strokeLinecap="round" />
              ))}
              {cornerFractions.map((f, i) => {
                const p = pts[Math.min(pts.length - 1, Math.round(f * (pts.length - 1)))]!;
                return <text key={i} x={p[0] + 9} y={p[1] - 7} className="fill-muted-foreground text-[10px] font-medium">T{i + 1}</text>;
              })}
              {markB && <circle cx={markB[0]} cy={markB[1]} r={6} fill="var(--driver-b)" stroke="var(--background)" strokeWidth={2} />}
              {markA && <circle cx={markA[0]} cy={markA[1]} r={6} fill="var(--driver-a)" stroke="var(--background)" strokeWidth={2} />}
            </svg>
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span>{Math.round(speed.lo)}</span>
              <span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg,${PLASMA.join(",")})` }} />
              <span>{Math.round(speed.hi)} km/h</span>
            </div>
          </>
        )}
        {kind === "mini" && (
          <>
            <p className="m-0 text-xs text-muted-foreground">24 mini sectors, timed at the gates.</p>
            <svg viewBox={`0 0 ${MW} ${MH}`} className="block h-auto w-full" role="img" aria-label="Track map with each mini sector in F1 timing colours">
              {minis.map((d, k) => (
                <path key={k} d={d} fill="none" stroke={col.mini[k] ? F1VAR[col.mini[k]] : "var(--border)"} strokeWidth={7} strokeLinejoin="round">
                  <title>{times.mini[k] !== undefined ? `Mini sector ${k + 1}: ${(times.mini[k] / HZ).toFixed(3)} s` : `Mini sector ${k + 1}: not reached`}</title>
                </path>
              ))}
              <circle cx={start[0]} cy={start[1]} r={4} fill="var(--foreground)" />
            </svg>
            <F1Key />
          </>
        )}
        {kind === "dominance" && dominance && (
          <>
            <p className="m-0 text-xs text-muted-foreground">25 equal stretches, each coloured by the faster driver.</p>
            <svg viewBox={`0 0 ${MW} ${MH}`} className="block h-auto w-full" role="img" aria-label="Track map with each stretch coloured by the faster driver">
              {dominance.segs.map((g, m) => (
                <path key={m} d={g.d} fill="none" stroke={g.a ? "var(--driver-a)" : "var(--driver-b)"} strokeWidth={7} strokeLinejoin="round">
                  <title>{`Stretch ${m + 1}: ${names[0]} ${g.tA.toFixed(3)} s, ${names[1]} ${g.tB.toFixed(3)} s`}</title>
                </path>
              ))}
              <circle cx={start[0]} cy={start[1]} r={4} fill="var(--foreground)" />
            </svg>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span><i className="mr-1.5 inline-block h-1 w-3.5 rounded-xs bg-driver-a align-[2px]" />{names[0]} {dominance.wa}</span>
              <span><i className="mr-1.5 inline-block h-1 w-3.5 rounded-xs bg-driver-b align-[2px]" />{names[1]} {dominance.wb}</span>
              <span>● start</span>
            </div>
          </>
        )}
      </div>
    </>
  );
}
