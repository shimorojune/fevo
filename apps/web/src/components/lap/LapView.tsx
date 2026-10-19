import { useEffect, useMemo, useRef, useState } from "react";
import type { LapResult } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HZ, STATUS_LABEL, trackName } from "@/lib/format";
import { cornerFractions, lapStats, sample, type Colours, type LapTimes } from "@/lib/lap";
import { drawMain, drawMap, drawTelemetry, geometry, tyreState, type Car } from "@/lib/replay";
import { indexAt, series } from "@/lib/series";
import { cn } from "@/lib/utils";
import { Maps } from "./Maps";
import { F1Key, F1Time, Sectors } from "./Sectors";
import { TRACES, Traces, type TraceKey } from "./Traces";

export interface LapBundle {
  track: TrackFile;
  model: LapResult;
  ghost?: LapResult | undefined;
  names: [string, string | null];
  ends: number[];
  times: LapTimes;
  col: Colours;
  ghostTimes?: LapTimes | undefined;
  ghostCol?: Colours | undefined;
}

const CAR = { length: 5.3, width: 1.9 };
const RATES = ["0.5", "1", "2", "4", "8"] as const;
type Rate = (typeof RATES)[number];
const clock = (f: number) => {
  const s = f / HZ;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};
const lapClock = (steps: number) => {
  const s = steps / HZ;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
};

/**
 * The lap view: replay (the app's renderer), telemetry strip and playback controls on the left;
 * traces open on demand in a dock under the track; Lap, Maps and Summary in tabs beside it.
 */
export function LapView({ lap, header }: { lap: LapBundle; header?: React.ReactNode }) {
  const { track, model, ghost, names } = lap;
  const a = model.trace!;
  const b = ghost?.trace;
  const steps = model.steps;
  const geo = useMemo(() => geometry(track), [track]);
  const cars = useMemo<Car[]>(
    () => [
      { trace: a, colors: { primary: "#2463eb", secondary: "#0b1d4a", accent: "#ffffff" } },
      ...(b ? [{ trace: b, colors: { primary: "#ffffff", secondary: "#121417", accent: "#121417" }, ghost: true }] : []),
    ],
    [a, b],
  );
  const s = useMemo(() => series(a, b, HZ), [a, b]);
  const cornersF = useMemo(() => cornerFractions(track), [track]);
  const statsA = useMemo(() => lapStats(model, HZ), [model]);
  const statsB = useMemo(() => (ghost ? lapStats(ghost, HZ) : null), [ghost]);

  const main = useRef<HTMLCanvasElement>(null);
  const tele = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(() => !matchMedia("(prefers-reduced-motion: reduce)").matches);
  const playRef = useRef(playing);
  playRef.current = playing;
  const [rate, setRate] = useState<Rate>("1");
  const rateRef = useRef(1);
  rateRef.current = +rate;
  const [zoom, setZoom] = useState(8);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [on, setOn] = useState<TraceKey[]>(b ? ["speed", "gap"] : ["speed"]);
  const [hoverK, setHoverK] = useState<number | null>(null);

  useEffect(() => {
    let last = performance.now();
    let tick = 0;
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playRef.current) {
        frameRef.current += dt * HZ * rateRef.current;
        if (frameRef.current >= steps) {
          frameRef.current = steps;
          setPlaying(false);
        }
      }
      const f = frameRef.current;
      if (main.current && main.current.offsetWidth > 0) drawMain(main.current, { geo, cars, frame: f, zoom: zoomRef.current, car: CAR, agentHz: HZ });
      if (tele.current && tele.current.offsetWidth > 0) drawTelemetry(tele.current, a, f);
      if (map.current && map.current.offsetWidth > 0) drawMap(map.current, geo, cars, f);
      if (++tick % 3 === 0) setFrame(f);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [geo, cars, a, steps]);

  const seek = (f: number, pause = true) => {
    frameRef.current = Math.max(0, Math.min(steps, f));
    setFrame(frameRef.current);
    if (pause) setPlaying(false);
  };
  const toggle = () => {
    if (frameRef.current >= steps) frameRef.current = 0;
    setPlaying((p) => !p);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "r" || e.key === "R") {
        frameRef.current = 0;
        setPlaying(true);
      } else if (e.key === "ArrowRight") seek(Math.floor(frameRef.current) + 1);
      else if (e.key === "ArrowLeft") seek(Math.ceil(frameRef.current) - 1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(30, z + 1));
      else if (e.key === "-") setZoom((z) => Math.max(1, z - 1));
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });

  const f = Math.min(frame, steps);
  const i = Math.floor(f);
  const k = indexAt(s, f);
  const ts = tyreState(a, Math.min(i, a.x.length - 1));
  const thr = Math.max(-1, Math.min(1, a.throttle[i] ?? 0));
  const str = Math.max(-1, Math.min(1, a.steer[i] ?? 0));
  const gapNow = s.gap?.[k];
  const finished = model.status === "finished";
  const result = f >= steps ? (finished ? `Finished ${clock(steps)}` : `${STATUS_LABEL[model.status] ?? model.status} at gate ${model.gatesPassed}`) : "Running";

  const meter = (v: number, color: string) => (
    <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
      <b className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px bg-border" />
      <i className="absolute top-0 bottom-0" style={{ left: v >= 0 ? "50%" : `${50 + v * 50}%`, width: `${Math.abs(v) * 50}%`, background: color }} />
    </div>
  );

  const sumRows: [string, React.ReactNode, React.ReactNode, number][] = [
    ["Lap time", <F1Time c={lap.col.lap}>{finished ? lapClock(model.steps) : "–"}</F1Time>, ghost ? <F1Time c={lap.ghostCol?.lap}>{ghost.status === "finished" ? lapClock(ghost.steps) : "–"}</F1Time> : null, -1],
    ...[0, 1, 2].map((n): [string, React.ReactNode, React.ReactNode, number] => [
      `Sector ${n + 1}`,
      <F1Time c={lap.col.sec[n]}>{lap.times.sec[n] != null ? (lap.times.sec[n]! / HZ).toFixed(3) : "–"}</F1Time>,
      ghost ? <F1Time c={lap.ghostCol?.sec[n]}>{lap.ghostTimes?.sec[n] != null ? (lap.ghostTimes.sec[n]! / HZ).toFixed(3) : "–"}</F1Time> : null,
      -1,
    ]),
    ["Top speed", `${statsA.topKmh.toFixed(0)} km/h`, statsB && `${statsB.topKmh.toFixed(0)} km/h`, statsB ? (statsA.topKmh >= statsB.topKmh ? 0 : 1) : -1],
    ["Average speed", statsA.avgKmh.toFixed(1), statsB?.avgKmh.toFixed(1), statsB ? (statsA.avgKmh >= statsB.avgKmh ? 0 : 1) : -1],
    ["Full throttle", `${statsA.fullThrottle.toFixed(1)}%`, statsB && `${statsB.fullThrottle.toFixed(1)}%`, statsB ? (statsA.fullThrottle >= statsB.fullThrottle ? 0 : 1) : -1],
    ["On the brakes", `${statsA.braking.toFixed(1)}%`, statsB && `${statsB.braking.toFixed(1)}%`, -1],
    ["Lock-ups", statsA.lockUps, statsB?.lockUps, statsB ? (statsA.lockUps <= statsB.lockUps ? 0 : 1) : -1],
  ];

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-4 pb-4 max-[980px]:grid-cols-1">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border max-[980px]:h-[78vh]">
        {header}
        <canvas ref={main} className="block min-h-[180px] w-full flex-auto" aria-label={`Follow-camera replay of the lap at ${trackName(track.circuitId)}`} />
        <canvas
          ref={tele}
          className="block h-16 w-full flex-none cursor-pointer border-t border-border"
          aria-label="Speed, throttle and brake along the lap; click to jump"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * steps, false);
          }}
        />
        {on.length > 0 && (
          <div className="scroll-panel max-h-[46%] flex-none animate-rise border-t border-border px-3 pt-2 pb-1.5">
            <Traces s={s} on={on} corners={cornersF} names={names} at={k} onHover={setHoverK} onSeek={(kk) => seek(s.fa[kk]!)} />
          </div>
        )}
        <div className="flex flex-none flex-wrap items-center gap-2.5 border-t border-border px-3 py-2">
          <Button variant="default" onClick={toggle} className="min-w-[66px]">
            {playing ? "Pause" : frame >= steps ? "Replay" : "Play"}
          </Button>
          <Button
            onClick={() => {
              frameRef.current = 0;
              setPlaying(true);
            }}
          >
            Restart
          </Button>
          <Segmented<Rate> label="Playback speed" value={rate} onChange={setRate} items={RATES.map((r) => ({ value: r, label: `${r}×` }))} />
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            Zoom
            <input type="range" min={1} max={30} step={0.5} value={zoom} onChange={(e) => setZoom(+e.target.value)} className="w-[100px] accent-foreground" />
          </label>
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Traces under the track">
            <span className="mr-0.5 text-[12.5px] text-muted-foreground">Traces</span>
            {TRACES.filter((t) => t.key !== "gap" || b).map((t) => {
              const pressed = on.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setOn((o) => (pressed ? o.filter((x) => x !== t.key) : [...o, t.key]))}
                  className={cn(
                    "h-7 rounded-full border px-[11px] text-[12.5px] transition-colors duration-150 active:scale-[.97]",
                    pressed ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.title}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <Tabs defaultValue="lap" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border">
        <TabsList aria-label="Lap details">
          <TabsTrigger value="lap">Lap</TabsTrigger>
          <TabsTrigger value="maps">Maps</TabsTrigger>
          <TabsTrigger value="sum">Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="lap" forceMount className="data-[state=inactive]:hidden">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat k="Lap time">{clock(f)}</Stat>
            <Stat k="Speed">{Math.round(sample(a.speed, f) * 3.6)} km/h</Stat>
            <Stat k="Gate">
              {a.gates[Math.min(i, a.gates.length - 1)] ?? 0} of {track.gates.length}
            </Stat>
            <Stat k={b ? "Gap to ghost" : "Gap"}>{gapNow === undefined ? "–" : `${gapNow >= 0 ? "+" : "−"}${Math.abs(gapNow).toFixed(3)}`}</Stat>
            <div>
              <div className="text-xs text-muted-foreground">Result</div>
              <div className={cn("text-sm", f >= steps && !finished && "text-destructive")}>{result}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tyres</div>
              <div className="text-sm">{ts.label || "Gripping"}</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Throttle / brake</div>
            {meter(thr, thr >= 0 ? "var(--success)" : "var(--destructive)")}
            <div className="mt-2.5 text-xs text-muted-foreground">Steer, left − / right +</div>
            {meter(str, "var(--foreground)")}
          </div>
          <Sectors ends={lap.ends} times={lap.times} col={lap.col} frame={f} steps={steps} finished={finished} />
          <canvas ref={map} className="block aspect-[1.3] w-full" aria-label="Position in lap" />
        </TabsContent>
        <TabsContent value="maps">
          <Maps track={track} s={s} a={a} b={b} names={names} times={lap.times} col={lap.col} at={hoverK ?? k} cornerFractions={cornersF} />
        </TabsContent>
        <TabsContent value="sum">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th />
                <th className="pb-1.5 text-right font-normal">
                  <i className="mr-1.5 inline-block h-[3px] w-2.5 rounded-xs bg-driver-a align-[3px]" />
                  {names[0]}
                </th>
                {ghost && (
                  <th className="pb-1.5 text-right font-normal">
                    <i className="mr-1.5 inline-block h-[3px] w-2.5 rounded-xs bg-driver-b align-[3px]" />
                    {names[1]}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sumRows.map(([label, va, vb, w]) => (
                <tr key={label} className="border-t border-border">
                  <td className="py-[7px] text-muted-foreground">{label}</td>
                  <td className={cn("py-[7px] text-right font-mono", w === 0 && "font-medium")}>{va}</td>
                  {ghost && <td className={cn("py-[7px] text-right font-mono", w === 1 && "font-medium")}>{vb}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <F1Key />
          <p className="m-0 text-xs text-muted-foreground">Laps and sectors are judged against every saved run on this track, as F1 timing does: other models for purple, this model's own runs for green.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
