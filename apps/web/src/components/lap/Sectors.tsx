import { HZ } from "@/lib/format";
import { MINI_SECTORS, PER_SECTOR, type Colours, type LapTimes } from "@/lib/lap";
import { cn } from "@/lib/utils";

const lapClock = (f: number) => {
  const s = f / HZ;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
};

/**
 * F1 sector timing, live with the replay: three sectors, each with its eight mini-sector
 * dashes and its time box. Dashes and times take their colour as the car completes them.
 */
export function Sectors({ ends, times, col, frame, steps, finished }: { ends: number[]; times: LapTimes; col: Colours; frame: number; steps: number; finished: boolean }) {
  const end = (k: number) => ends[k] ?? Infinity;
  const startOf = (s: number) => (s ? end(s * PER_SECTOR - 1) : 0);
  const running = frame < steps;
  const done = !running && finished;
  return (
    <div>
      <div className="text-xs text-muted-foreground">Sectors</div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {[0, 1, 2].map((s) => {
          const sDone = end((s + 1) * PER_SECTOR - 1) <= frame;
          const sLive = !sDone && startOf(s) <= frame && running;
          const t = times.sec[s];
          const c = col.sec[s];
          return (
            <div key={s} className={cn("flex flex-col gap-[7px] rounded-sm border px-2 pt-[7px] pb-2 transition-colors duration-200", sLive ? "border-foreground" : "border-border")}>
              <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                <b className="font-semibold tracking-[.02em] text-foreground">S{s + 1}</b>
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {Array.from({ length: PER_SECTOR }, (_, j) => {
                  const k = s * PER_SECTOR + j;
                  const kDone = k < MINI_SECTORS && end(k) <= frame;
                  const now = !kDone && (k === 0 || end(k - 1) <= frame) && running && k < ends.length + 1;
                  return <i key={j} title={kDone ? `Mini sector ${k + 1}: ${(times.mini[k]! / HZ).toFixed(3)} s` : `Mini sector ${k + 1}`} className={cn("f1-dash h-[5px] rounded-[1px] bg-muted transition-colors duration-250", kDone && `f1-${col.mini[k]}`, now && "now")} />;
                })}
              </div>
              {sDone && t != null && c ? (
                <div key="done" className={cn("f1-set rounded-xs py-[3px] text-center font-mono text-[15px] font-medium tracking-[-0.02em]", `f1-${c}`)}>{(t / HZ).toFixed(3)}</div>
              ) : sLive ? (
                <div className="rounded-xs py-[3px] text-center font-mono text-[15px] tracking-[-0.02em]">{((frame - startOf(s)) / HZ).toFixed(1)}</div>
              ) : (
                <div className="rounded-xs bg-muted py-[3px] text-center font-mono text-[15px] text-muted-foreground">–</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>Lap</span>
        <b className={cn("rounded-xs px-2 py-px font-mono text-[13px] font-medium text-foreground", done && col.lap && `f1-${col.lap}`)}>{lapClock(Math.min(frame, steps))}</b>
      </div>
    </div>
  );
}

export function F1Key({ labels = ["Fastest overall", "Personal best", "Slower than own best"] }: { labels?: [string, string, string] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      {(["p", "g", "y"] as const).map((c, i) => (
        <span key={c} className="flex items-center gap-1.5">
          <i className={cn("inline-block size-2.5 rounded-[2px]", `f1-${c}`)} />
          {labels[i]}
        </span>
      ))}
    </div>
  );
}

/** A time in its F1 colour, for tables. */
export function F1Time({ c, children, className }: { c: string | null | undefined; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-block min-w-16 rounded-xs px-2 py-px text-right font-mono", c && `f1-${c}`, className)}>{children}</span>;
}
