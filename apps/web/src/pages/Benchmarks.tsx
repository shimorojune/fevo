import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHead } from "@/components/AppShell";
import { TrackOutline } from "@/components/TrackOutline";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { api, useApi, type BenchmarkCell, type Drive, type ModelSummary, type TrackSummary } from "@/lib/api";
import { HZ, lapTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useAllTracks } from "@/lib/useTrack";
import { cn } from "@/lib/utils";

const ERRORS = ["0", "3", "6", "10"] as const;
type Err = (typeof ERRORS)[number];
type Stat = "median" | "best";
const pct = (e: number) => String(Math.round(e * 100));
const STATUS = { house: "House", candidate: "Candidate", archived: "Archived" } as const;

/** Every model on every track at one driver-error level, from the laps saved in History. */
export function Benchmarks() {
  const navigate = useNavigate();
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const cells = useApi(api.benchmarks, "benchmarks");
  const files = useAllTracks(tracks.data?.map((t) => t.id) ?? []);
  const [params] = useSearchParams();
  const [err, setErr] = useState<Err>(() => ERRORS.find((e) => e === params.get("err")) ?? "0");
  const [stat, setStat] = useState<Stat>("median");
  const [picked, setPicked] = useState<string>();
  // New laps arrive one by one while a batch runs; refresh the table at most every couple of seconds.
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useLive((e) => {
    if (e.type !== "drive" || pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = undefined;
      cells.reload();
    }, 2000);
  });
  useEffect(() => () => clearTimeout(pending.current), []);

  const live = (models.data ?? []).filter((m) => m.status !== "archived");
  const ts = tracks.data ?? [];
  const at = useMemo(() => {
    const m = new Map<string, BenchmarkCell>();
    for (const c of cells.data ?? []) if (pct(c.errorLevel) === err) m.set(`${c.modelId}|${c.trackId}`, c);
    return m;
  }, [cells.data, err]);
  const val = (c: BenchmarkCell | undefined) => (c ? (stat === "median" ? c.medianSteps : c.bestSteps) : null);
  const fastest = useMemo(() => Object.fromEntries(ts.map((t) => [t.id, Math.min(Infinity, ...live.map((m) => val(at.get(`${m.id}|${t.id}`)) ?? Infinity))])), [ts, live, at, stat]);

  const rows = live
    .map((m) => {
      const cs = ts.map((t) => at.get(`${m.id}|${t.id}`));
      const offs = ts.map((t, i) => {
        const v = val(cs[i]);
        return v === null ? null : ((v - fastest[t.id]!) / fastest[t.id]!) * 100;
      });
      const laps = cs.reduce((n, c) => n + (c?.laps ?? 0), 0);
      const fin = cs.reduce((n, c) => n + (c?.finished ?? 0), 0);
      return { m, off: ts.length && offs.every((o) => o !== null) ? offs.reduce((a, b) => a! + b!, 0)! / ts.length : null, rate: laps ? fin / laps : null };
    })
    .sort((a, b) => (a.off ?? Infinity) - (b.off ?? Infinity) || (b.rate ?? -1) - (a.rate ?? -1));
  const sel = picked ?? (rows[0] && ts[0] ? `${rows[0].m.id}|${ts[0].id}` : undefined);
  const [selM, selT] = sel?.split("|") ?? [];

  const toBatch = (ms: string[], tr: string[]) => navigate(`/batches?${new URLSearchParams({ models: ms.join(","), tracks: tr.join(","), errors: err })}`);
  const fill = () => {
    const miss = live.flatMap((m) => ts.filter((t) => !at.has(`${m.id}|${t.id}`)).map((t) => [m.id, t.id] as const));
    if (miss.length) toBatch([...new Set(miss.map((x) => x[0]))], [...new Set(miss.map((x) => x[1]))]);
    else toBatch(live.map((m) => m.id), ts.map((t) => t.id));
  };
  const error = models.error ?? tracks.error ?? cells.error;

  return (
    <>
      <PageHead title="Benchmarks" sub="Every model on every track, from the laps saved in History. With driver error on, every lap draws new mistakes. Fastest on each track in purple.">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
          Driver error
          <Segmented<Err> label="Driver error" value={err} onChange={setErr} items={ERRORS.map((v) => ({ value: v, label: `${v}%` }))} />
        </span>
        <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
          Time
          <Segmented<Stat>
            label="Time shown"
            value={stat}
            onChange={setStat}
            items={[
              { value: "median", label: "Median" },
              { value: "best", label: "Best" },
            ]}
          />
        </span>
        <Button onClick={fill} disabled={!live.length || !ts.length} title="Start a batch for the models and tracks with no laps at this error level">
          Fill gaps
        </Button>
      </PageHead>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-4 pb-4 max-[980px]:grid-cols-1">
        <Panel>
          {error && <p className="m-0 px-4 py-3 text-[13px] text-destructive">{error}</p>}
          <div className="scroll-panel">
            <table key={`${err}|${stat}`} className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-7 px-3 py-2.5 text-right font-normal">#</th>
                  <th className="px-3 py-2.5 text-left font-normal">Model</th>
                  {ts.map((t) => (
                    <th key={t.id} className="px-3 py-2.5 text-right align-bottom font-normal">
                      <TrackOutline track={files[t.id]} w={34} h={22} className="mb-1 ml-auto block text-foreground" />
                      {t.name}
                    </th>
                  ))}
                  <th className="px-3 py-2.5 text-right font-normal">Finished</th>
                  <th className="px-3 py-2.5 text-right font-normal whitespace-nowrap">Off the fastest</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.m.id} className="border-t border-border animate-rise first:border-t-0" style={{ animationDelay: `${Math.min(i, 5) * 20}ms` }}>
                    <td className="px-3 py-[11px] text-right font-mono text-muted-foreground">{row.off !== null ? i + 1 : "–"}</td>
                    <td className="px-3 py-[11px]">
                      <span className="font-medium">{row.m.name}</span>
                      <small className="block text-[11.5px] text-muted-foreground">
                        {row.m.kind === "mlp" ? "MLP" : "NEAT"} · {STATUS[row.m.status]}
                      </small>
                    </td>
                    {ts.map((t) => {
                      const key = `${row.m.id}|${t.id}`;
                      const c = at.get(key);
                      const v = val(c);
                      const purple = v !== null && v === fastest[t.id];
                      return (
                        <td
                          key={t.id}
                          onClick={() => setPicked(key)}
                          className={cn("cursor-pointer px-3 py-[11px] text-right font-mono transition-colors hover:bg-muted", key === sel && "bg-selected hover:bg-selected")}
                        >
                          {!c ? (
                            <>
                              <span className="text-muted-foreground">–</span>
                              <small className="block font-sans text-[11.5px] text-muted-foreground">no laps at {err}%</small>
                            </>
                          ) : (
                            <>
                              {v !== null ? <span className={cn(purple && "font-medium text-sector-purple-text")}>{lapTime(v)}</span> : <span className="font-sans text-destructive">never finished</span>}
                              <small className="flex items-center justify-end gap-1.5 text-[11.5px] text-muted-foreground">
                                <span className="relative inline-block h-1 w-7 overflow-hidden rounded-full bg-muted">
                                  <i className="absolute inset-y-0 left-0 bg-success" style={{ width: `${(c.finished / c.laps) * 100}%` }} />
                                </span>
                                {c.finished}/{c.laps}
                                {v !== null && (purple ? " · fastest" : ` · +${((v - fastest[t.id]!) / HZ).toFixed(3)}`)}
                              </small>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-[11px] text-right font-mono">{row.rate === null ? "–" : `${Math.round(row.rate * 100)}%`}</td>
                    <td className="px-3 py-[11px] text-right font-mono">{row.off === null ? <span className="font-sans text-muted-foreground">gaps</span> : row.off < 0.0005 ? "fastest" : `+${row.off.toFixed(1)}%`}</td>
                  </tr>
                ))}
                {models.data && rows.length === 0 && (
                  <tr>
                    <td colSpan={ts.length + 4} className="px-3 py-6 text-muted-foreground">
                      No models yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        {selM && selT ? (
          <CellInspector
            key={sel}
            m={live.find((m) => m.id === selM)}
            t={ts.find((t) => t.id === selT)}
            file={files[selT]}
            err={err}
            stat={stat}
            cells={cells.data ?? []}
            rivals={live}
            onBatch={() => toBatch([selM], [selT])}
          />
        ) : (
          <Panel className="p-4 text-[13px] text-muted-foreground">Pick a cell.</Panel>
        )}
      </div>
    </>
  );
}

function CellInspector({ m, t, file, err, stat, cells, rivals, onBatch }: { m: ModelSummary | undefined; t: TrackSummary | undefined; file: import("@fevo/tracks").TrackFile | undefined; err: Err; stat: Stat; cells: BenchmarkCell[]; rivals: ModelSummary[]; onBatch: () => void }) {
  const navigate = useNavigate();
  const drives = useApi(() => (m && t ? api.drives({ model: m.id, track: t.id, limit: 2000 }) : Promise.resolve([] as Drive[])), `bench:${m?.id}|${t?.id}`);
  const [busy, setBusy] = useState(false);
  useLive((e) => {
    if (e.type === "drive" && e.drive.modelId === m?.id && e.drive.trackId === t?.id) drives.setData((l) => (l ? [e.drive, ...l] : l));
  });
  if (!m || !t) return <Panel className="p-4 text-[13px] text-muted-foreground">Pick a cell.</Panel>;
  const cellOf = (modelId: string) => cells.find((c) => c.modelId === modelId && c.trackId === t.id && pct(c.errorLevel) === err);
  const c = cellOf(m.id);
  const v = c ? (stat === "median" ? c.medianSteps : c.bestSteps) : null;
  const fast = rivals
    .map((o) => {
      const oc = cellOf(o.id);
      return { o, v: oc ? (stat === "median" ? oc.medianSteps : oc.bestSteps) : null };
    })
    .filter((x): x is { o: ModelSummary; v: number } => x.v !== null)
    .sort((a, b) => a.v - b.v)[0];

  const per = ERRORS.map((e) => {
    const l = (drives.data ?? []).filter((d) => pct(d.errorLevel) === e);
    const f = l.filter((d) => d.status === "finished").map((d) => d.steps).sort((a, b) => a - b);
    return { e, n: l.length, laps: f, med: f.length ? f[Math.floor((f.length - 1) / 2)]! : null, crashes: l.length - f.length };
  });
  const all = per.flatMap((p) => p.laps);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const span = Math.max(hi - lo, 30);
  const W = 320, L = 44, R = 88, RH = 30;
  const H = per.length * RH + 24;
  const X = (st: number) => L + ((st - lo) / span) * (W - L - R);

  const compare = async () => {
    setBusy(true);
    try {
      const here = (await api.drives({ track: t.id, limit: 2000 })).filter((d) => d.status === "finished" && pct(d.errorLevel) === err).sort((x, y) => x.steps - y.steps);
      const mine = here.find((d) => d.modelId === m.id);
      const other = here.find((d) => d.modelId !== m.id);
      if (mine) navigate(`/compare?${new URLSearchParams({ track: t.id, a: String(mine.id), ...(other ? { b: String(other.id) } : { q: "fast" }) })}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="animate-fade">
      <PanelHeader>
        <h2>{m.name}</h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <TrackOutline track={file} className="text-foreground" />
          {t.name}
        </span>
      </PanelHeader>
      <div className="scroll-panel flex flex-col gap-[18px] px-4 py-3.5 [&>*]:animate-rise">
        <div>
          <div className="text-xs text-muted-foreground">
            {stat === "median" ? "Median" : "Best"} lap at {err}% driver error
          </div>
          <div className="font-mono text-[28px] font-light tracking-[-0.04em]">{v !== null ? lapTime(v) : "–"}</div>
          <div className="text-xs text-muted-foreground">
            {c ? `${c.finished} of ${c.laps} laps finished` : "No laps at this level yet"}
            {v !== null && fast && (fast.o.id !== m.id ? ` · +${((v - fast.v) / HZ).toFixed(3)} to ${fast.o.name}` : " · fastest here")}
          </div>
        </div>
        <div>
          <p className="mt-0 mb-2 text-xs text-muted-foreground">Every lap by driver error. Dots are laps, the tick is the median.</p>
          <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={`Lap times for ${m.name} at ${t.name} at each driver error level`}>
            {per.map((p, i) => {
              const y = 14 + i * RH;
              return (
                <g key={p.e}>
                  {p.e === err && <rect x={0} y={y - 12} width={W} height={RH - 4} rx={6} fill="var(--muted)" />}
                  <text x={6} y={y + 4} fill="var(--muted-foreground)" fontSize={11} fontFamily="var(--font-mono)">
                    {p.e}%
                  </text>
                  <line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--border)" />
                  {p.laps.map((st, j) => (
                    <circle key={j} cx={X(st)} cy={y} r={3.2} fill="var(--driver-a)" fillOpacity={0.55} />
                  ))}
                  {p.med !== null && <line x1={X(p.med)} x2={X(p.med)} y1={y - 8} y2={y + 8} stroke="var(--foreground)" strokeWidth={1.5} />}
                  <text x={W - R + 8} y={y + 4} fontSize={11} fill={p.crashes ? "var(--destructive)" : "var(--muted-foreground)"}>
                    {!p.n ? "no laps" : p.crashes ? `${p.crashes} crashed` : "all finished"}
                  </text>
                </g>
              );
            })}
            {all.length > 0 && (
              <>
                <text x={L} y={H - 2} fontSize={10} fill="var(--muted-foreground)" fontFamily="var(--font-mono)">
                  {lapTime(lo)}
                </text>
                <text x={W - R} y={H - 2} fontSize={10} fill="var(--muted-foreground)" fontFamily="var(--font-mono)" textAnchor="end">
                  {lapTime(lo + span)}
                </text>
              </>
            )}
          </svg>
          {drives.data && drives.data.length >= 2000 && <p className="mt-1 mb-0 text-xs text-muted-foreground">Showing the latest 2,000 laps.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="default" disabled={v === null || busy} onClick={() => void compare()}>
            Compare with the fastest
          </Button>
          <Button onClick={() => navigate(`/history?${new URLSearchParams({ model: m.id, track: t.id })}`)}>Laps in History</Button>
          <Button onClick={onBatch}>Run more</Button>
        </div>
        <p className="m-0 text-xs text-muted-foreground">Seeds 1 to 3. At 0% the same model, track and seed always drive the same lap, so repeats add nothing; with error on, each lap draws new mistakes, so more laps give a steadier median.</p>
      </div>
    </Panel>
  );
}
