import { HZ } from "@/lib/format";
import { STEP_M, type Series } from "@/lib/series";
import { cn } from "@/lib/utils";

const fmt = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(3)}`;

/**
 * Corner by corner: where the gap between the two cars opens and closes. Each corner runs from
 * halfway after the previous one to halfway before the next; minimum speeds are within 80 m of the
 * apex. Negative is time the lead car (A) gains. Clicking a corner plays the replay from there.
 */
export function Corners({ s, corners, names, steps, onSeek }: { s: Series; corners: number[]; names: [string, string | null]; steps: [number | null, number | null]; onSeek: (k: number) => void }) {
  const gap = s.gap!;
  const kd = (d: number) => Math.max(0, Math.min(s.d.length - 1, Math.round(d / STEP_M)));
  const minNear = (arr: number[], c: number) => {
    let v = Infinity;
    for (let k = kd(c - 80); k <= kd(c + 80); k++) v = Math.min(v, arr[k]!);
    return v;
  };
  const cs = corners.map((f, i) => ({ n: i + 1, d: f * s.length }));
  const rows = cs.map((c, i) => {
    const e0 = i ? (cs[i - 1]!.d + c.d) / 2 : 0;
    const e1 = i < cs.length - 1 ? (c.d + cs[i + 1]!.d) / 2 : s.length;
    return { n: c.n, k0: kd(e0), v: -(gap[kd(e1)]! - gap[kd(e0)]!), a: minNear(s.speedA, c.d), b: minNear(s.speedB!, c.d) };
  });
  const mx = Math.max(0.05, ...rows.map((r) => Math.abs(r.v)));
  const total = steps[0] !== null && steps[1] !== null ? (steps[1] - steps[0]) / HZ : null;
  const top = [...rows].sort((x, y) => x.v - y.v).slice(0, 3).filter((r) => r.v < 0);
  const lead = total === null ? null : total >= 0 ? names[0] : names[1];

  return (
    <>
      <div>
        <h3 className="m-0 text-[13px] font-medium">Corner by corner</h3>
        <p className="m-0 text-[13px] text-muted-foreground">
          {total === null
            ? "One of the laps didn't finish, so this compares both up to where it stopped."
            : `${lead} is ${Math.abs(total).toFixed(3)} s faster over the lap.`}
          {top.length > 0 && ` ${names[0]} gains most at ${top.map((r) => `T${r.n} (${Math.abs(r.v).toFixed(2)} s)`).join(", ")}.`}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">No corners tight enough to mark on this track.</p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="pb-1.5 text-left font-normal">Corner</th>
              <th className="pb-1.5 text-right font-normal">
                <i className="mr-1.5 inline-block h-[3px] w-2.5 rounded-xs bg-driver-a align-[3px]" />
                Min
              </th>
              <th className="pb-1.5 text-right font-normal">
                <i className="mr-1.5 inline-block h-[3px] w-2.5 rounded-xs bg-driver-b align-[3px]" />
                Min
              </th>
              <th className="w-[38%] pb-1.5 font-normal" />
              <th className="pb-1.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const gain = r.v < 0;
              const w = (Math.abs(r.v) / mx) * 50;
              return (
                <tr key={r.n} onClick={() => onSeek(r.k0)} className="cursor-pointer border-t border-border transition-colors hover:bg-muted" title={`Watch T${r.n}`}>
                  <td className="py-[7px]">T{r.n}</td>
                  <td className="py-[7px] text-right font-mono">{Math.round(r.a)}</td>
                  <td className="py-[7px] text-right font-mono">{Math.round(r.b)}</td>
                  <td className="px-2 py-[7px]">
                    <div className="relative h-2">
                      <b className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px bg-border" />
                      <i className={cn("absolute top-0 bottom-0 rounded-[1px]", gain ? "bg-success" : "bg-loss")} style={gain ? { right: "50%", width: `${w}%` } : { left: "50%", width: `${w}%` }} />
                    </div>
                  </td>
                  <td className={cn("py-[7px] text-right font-mono", gain ? "text-success" : "text-loss")}>{fmt(r.v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-[2px] bg-success" />
          {names[0]} gains
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-2.5 rounded-[2px] bg-loss" />
          {names[0]} loses
        </span>
      </div>
      <p className="m-0 text-xs text-muted-foreground">Each corner runs from halfway after the previous corner to halfway before the next. Minimum speeds, km/h, are near the apex. Click a corner to watch it.</p>
    </>
  );
}
