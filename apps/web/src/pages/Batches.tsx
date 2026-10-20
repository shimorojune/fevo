import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHead } from "@/components/AppShell";
import { TrackOutline } from "@/components/TrackOutline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { api, useApi, type Batch, type Drive, type ModelSummary, type TrackSummary } from "@/lib/api";
import { runner, useRunner } from "@/lib/batch";
import { lapTime } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useAllTracks } from "@/lib/useTrack";
import { cn } from "@/lib/utils";
import { POOL_SIZE } from "@/sim/client";

const ERRORS = [0, 3, 6, 10];
const DRAWS = ["1", "3", "5", "10"] as const;
type Draws = (typeof DRAWS)[number];
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const pctOf = (b: Batch) => (b.total ? Math.round((b.done / b.total) * 100) : 0);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** A running batch counts as running elsewhere while its laps keep arriving. */
const ELSEWHERE_MS = 15_000;

type Shown = "here" | "elsewhere" | "interrupted" | Batch["status"];

function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("relative h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <i className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-300" style={{ width: `${value}%` }} />
    </div>
  );
}

function StatusBadge({ s }: { s: Shown }) {
  if (s === "here") return <Badge tone="run" dot live>Running</Badge>;
  if (s === "elsewhere") return <Badge tone="run" dot>Running elsewhere</Badge>;
  if (s === "interrupted") return <Badge tone="bad">Interrupted</Badge>;
  if (s === "done") return <Badge tone="ok">Done</Badge>;
  return <Badge>{s === "paused" ? "Paused" : "Stopped"}</Badge>;
}

/** Many scenarios in one go: laps run in this tab on the batch workers and are saved to History. */
export function Batches() {
  const [params] = useSearchParams();
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const batches = useApi(api.batches, "batches");
  const files = useAllTracks(tracks.data?.map((t) => t.id) ?? []);
  const run = useRunner();
  const live = (models.data ?? []).filter((m) => m.status !== "archived");
  const ts = tracks.data ?? [];

  const [fm, setFm] = useState<Set<string>>(new Set());
  const [ft, setFt] = useState<Set<string>>(new Set());
  const [fs, setFs] = useState<Set<number>>(new Set([0, 1, 2]));
  const [fe, setFe] = useState<Set<number>>(new Set(ERRORS));
  const [fd, setFd] = useState<Draws>("3");
  const [picked, setPicked] = useState<number>();
  const [error, setError] = useState<string>();
  const [seen, setSeen] = useState<Record<number, number>>({});
  const [now, setNow] = useState(Date.now());

  // The form starts with every model and track, or with what Benchmarks asked for.
  useEffect(() => {
    if (!models.data || !tracks.data) return;
    const list = (k: string) => params.get(k)?.split(",").filter(Boolean);
    const ms = list("models")?.filter((id) => live.some((m) => m.id === id));
    const tr = list("tracks")?.filter((id) => ts.some((t) => t.id === id));
    const es = list("errors")?.map(Number).filter((e) => ERRORS.includes(e));
    setFm(new Set(ms?.length ? ms : live.map((m) => m.id)));
    setFt(new Set(tr?.length ? tr : ts.map((t) => t.id)));
    if (es?.length) setFe(new Set(es));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.data, tracks.data, params]);

  useLive((e) => {
    if (e.type === "batch") batches.setData((l) => (l ? (l.some((b) => b.id === e.batch.id) ? l.map((b) => (b.id === e.batch.id ? e.batch : b)) : [e.batch, ...l]) : l));
    if (e.type === "drive" && e.drive.batchId !== null) {
      const id = e.drive.batchId;
      const fin = e.drive.status === "finished" ? 1 : 0;
      batches.setData((l) => l?.map((b) => (b.id === id ? { ...b, done: b.done + 1, finished: b.finished + fin } : b)));
      setSeen((s) => ({ ...s, [id]: Date.now() }));
    }
  });
  const anyRunning = (batches.data ?? []).some((b) => b.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const shown = (b: Batch): Shown => {
    if (b.status !== "running") return b.status;
    if (run.active && run.batchId === b.id) return "here";
    return now - (seen[b.id] ?? 0) < ELSEWHERE_MS ? "elsewhere" : "interrupted";
  };

  const perSeed = [...fe].reduce((n, e) => n + (e === 0 ? 1 : +fd), 0);
  const total = fm.size * ft.size * fs.size * perSeed;
  const clean = fe.has(0) ? fm.size * ft.size * fs.size : 0;
  const toggle = <T,>(set: Set<T>, v: T, put: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    put(n);
  };

  async function start() {
    setError(undefined);
    try {
      const b = await api.createBatch({
        modelIds: live.filter((m) => fm.has(m.id)).map((m) => m.id),
        trackIds: ts.filter((t) => ft.has(t.id)).map((t) => t.id),
        seeds: [...fs].sort(),
        errorLevels: ERRORS.filter((e) => fe.has(e)).map((e) => e / 100),
        draws: +fd,
      });
      batches.setData((l) => [b, ...(l ?? []).filter((x) => x.id !== b.id)]);
      setPicked(b.id);
      await runner.run(b);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const list = batches.data ?? [];
  const selected = list.find((b) => b.id === picked) ?? list[0];
  const err = error ?? models.error ?? tracks.error ?? batches.error;

  return (
    <>
      <PageHead title="Batches" sub={`Run many scenarios in one go. Laps run in this browser tab, ${POOL_SIZE} at a time, and every lap is saved to History.`} />
      <div className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)_340px] gap-4 pb-4 max-[1180px]:grid-cols-[280px_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <Panel aria-label="New batch">
          <PanelHeader>
            <h2>New batch</h2>
          </PanelHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <div className="scroll-panel flex flex-1 flex-col gap-[18px] px-4 py-3.5">
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-1.5 p-0 text-xs text-muted-foreground">Models</legend>
                {live.map((m) => (
                  <label key={m.id} className="flex cursor-pointer items-center gap-2.5 py-1 text-[13px]">
                    <input type="checkbox" className="accent-foreground" checked={fm.has(m.id)} onChange={() => toggle(fm, m.id, setFm)} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <small className="text-[11.5px] text-muted-foreground">{m.kind === "mlp" ? "MLP" : "NEAT"}</small>
                  </label>
                ))}
              </fieldset>
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-1.5 p-0 text-xs text-muted-foreground">Tracks</legend>
                {ts.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2.5 py-1 text-[13px]">
                    <input type="checkbox" className="accent-foreground" checked={ft.has(t.id)} onChange={() => toggle(ft, t.id, setFt)} />
                    <TrackOutline track={files[t.id]} w={26} h={17} className="text-foreground" />
                    {t.name}
                  </label>
                ))}
              </fieldset>
              <Chips label="Seeds" items={[0, 1, 2].map((s) => ({ v: s, label: `Seed ${s + 1}` }))} on={fs} onToggle={(v) => toggle(fs, v, setFs)} />
              <Chips label="Driver error" items={ERRORS.map((e) => ({ v: e, label: `${e}%` }))} on={fe} onToggle={(v) => toggle(fe, v, setFe)} />
              <div>
                <div className="mb-1.5 text-xs text-muted-foreground">Laps per setting with error on</div>
                <Segmented<Draws> label="Laps per setting" value={fd} onChange={setFd} items={DRAWS.map((d) => ({ value: d, label: d }))} />
                <p className="mt-1.5 mb-0 text-xs text-muted-foreground">0% gives the same lap every time, so it runs once per seed.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
              <div className="text-[12.5px] text-muted-foreground">
                {total ? (
                  <>
                    <b className="font-mono font-medium text-foreground">{total.toLocaleString()}</b> laps: {plural(fm.size, "model")} × {plural(ft.size, "track")} × {plural(fs.size, "seed")}
                    {clean > 0 && `, ${clean.toLocaleString()} clean`}
                    {total - clean > 0 && `, ${(total - clean).toLocaleString()} with error`}
                  </>
                ) : (
                  "Pick at least one of each."
                )}
              </div>
              {run.active && <div className="text-xs text-muted-foreground">Batch #{run.batchId} is running in this tab. Pause it to start another.</div>}
              {err && <div className="text-xs text-destructive">{err}</div>}
              <Button type="submit" variant="default" disabled={!total || total > 50_000 || run.active}>
                Start batch
              </Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <div className="scroll-panel">
            <table className="w-full min-w-[600px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 text-left font-normal">Batch</th>
                  <th className="px-3 py-2.5 text-left font-normal">Scope</th>
                  <th className="px-3 py-2.5 text-left font-normal">Progress</th>
                  <th className="px-3 py-2.5 text-right font-normal">Finished</th>
                  <th className="px-3 py-2.5 text-left font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((b, i) => (
                  <tr
                    key={b.id}
                    onClick={() => setPicked(b.id)}
                    style={{ animationDelay: `${Math.min(i, 5) * 20}ms` }}
                    className={cn("cursor-pointer border-t border-border animate-rise transition-colors first:border-t-0 hover:bg-muted", selected?.id === b.id && "bg-selected hover:bg-selected")}
                  >
                    <td className="px-3 py-[11px]">
                      <span className="font-mono">#{b.id}</span>
                      <small className="block text-[11.5px] whitespace-nowrap text-muted-foreground">{when(b.createdAt)}</small>
                    </td>
                    <td className="px-3 py-[11px]">
                      {plural(b.modelIds.length, "model")} · {plural(b.trackIds.length, "track")} · {b.errorLevels.map((e) => `${Math.round(e * 100)}%`).join(" ")}
                      <small className="block text-[11.5px] text-muted-foreground">
                        seeds {b.seeds.map((s) => s + 1).join(", ")} · {b.draws} per error setting
                      </small>
                    </td>
                    <td className="min-w-[120px] px-3 py-[11px]">
                      <Progress value={pctOf(b)} />
                      <small className="mt-1 block font-mono text-[11.5px] text-muted-foreground">
                        {b.done.toLocaleString()} of {b.total.toLocaleString()}
                      </small>
                    </td>
                    <td className="px-3 py-[11px] text-right font-mono">{b.done ? `${Math.round((b.finished / b.done) * 100)}%` : "–"}</td>
                    <td className="px-3 py-[11px]">
                      <StatusBadge s={shown(b)} />
                    </td>
                  </tr>
                ))}
                {batches.data && list.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-muted-foreground">
                      No batches yet. Pick models, tracks and error levels on the left and start one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {selected ? (
          <BatchDetail key={selected.id} b={selected} s={shown(selected)} models={models.data ?? []} tracks={ts} files={files} runError={run.batchId === selected.id ? run.error : null} />
        ) : (
          <Panel className="p-4 text-[13px] text-muted-foreground max-[1180px]:col-span-2 max-[980px]:col-span-1">No batches yet.</Panel>
        )}
      </div>
    </>
  );
}

function Chips<V extends number>({ label, items, on, onToggle }: { label: string; items: { v: V; label: string }[]; on: Set<V>; onToggle: (v: V) => void }) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => {
          const pressed = on.has(it.v);
          return (
            <button
              key={it.v}
              type="button"
              aria-pressed={pressed}
              onClick={() => onToggle(it.v)}
              className={cn(
                "h-7 rounded-full border px-[11px] text-[12.5px] transition-colors duration-150 active:scale-[.97]",
                pressed ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground",
              )}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BatchDetail({ b, s, models, tracks, files, runError }: { b: Batch; s: Shown; models: ModelSummary[]; tracks: TrackSummary[]; files: Record<string, import("@fevo/tracks").TrackFile>; runError: string | null }) {
  const navigate = useNavigate();
  const drives = useApi(() => api.drives({ batch: b.id, limit: 50_000 }), `batch:${b.id}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useLive((e) => {
    if (e.type === "drive" && e.drive.batchId === b.id) drives.setData((l) => (l ? [e.drive, ...l.filter((d) => d.id !== e.drive.id)] : l));
  });
  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  const runs = drives.data ?? [];
  const levels = useMemo(
    () =>
      b.errorLevels.map((e) => {
        const l = runs.filter((d) => d.errorLevel === e);
        return { e, n: l.length, f: l.filter((d) => d.status === "finished").length };
      }),
    [runs, b.errorLevels],
  );
  const fastest = useMemo(
    () => b.trackIds.map((t) => ({ t, d: runs.filter((d) => d.trackId === t && d.status === "finished").sort((x, y) => x.steps - y.steps)[0] as Drive | undefined })),
    [runs, b.trackIds],
  );

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    fn()
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const head = s === "here" ? "Running in this tab" : s === "elsewhere" ? "Running in another tab" : s === "interrupted" ? "Interrupted: the tab running it closed" : s === "paused" ? "Paused" : s === "stopped" ? "Stopped early" : "Finished";
  const errPct = Math.round((b.errorLevels.includes(0) ? 0 : b.errorLevels[0]!) * 100);

  return (
    <Panel className="animate-fade max-[1180px]:col-span-2 max-[980px]:col-span-1">
      <PanelHeader>
        <h2>Batch #{b.id}</h2>
        <StatusBadge s={s} />
      </PanelHeader>
      <div className="scroll-panel flex flex-col gap-[18px] px-4 py-3.5 [&>*]:animate-rise">
        <div>
          <div className="text-xs text-muted-foreground">{head}</div>
          <div className="font-mono text-[28px] font-light tracking-[-0.04em]">
            {b.done.toLocaleString()} <span className="font-sans text-lg text-muted-foreground">of {b.total.toLocaleString()} laps</span>
          </div>
          <Progress value={pctOf(b)} className="mt-2" />
        </div>
        {(runError ?? error) && <p className="m-0 text-[13px] text-destructive">{runError ?? error}</p>}
        <div>
          <div className="mb-2 text-xs text-muted-foreground">Finish rate by driver error</div>
          {levels.map((l) => (
            <div key={l.e} className="grid grid-cols-[40px_1fr_44px] items-center gap-2.5 py-1 text-[13px]">
              <span className="font-mono">{Math.round(l.e * 100)}%</span>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                <i className="absolute inset-y-0 left-0 rounded-full bg-success transition-[width] duration-300" style={{ width: `${l.n ? (l.f / l.n) * 100 : 0}%` }} />
              </div>
              <span className="text-right font-mono">{l.n ? `${Math.round((l.f / l.n) * 100)}%` : "–"}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Fastest lap per track</div>
          {fastest.map(({ t, d }) => (
            <div key={t} className="flex items-center gap-3 border-t border-border py-2 text-[13px] first:border-t-0">
              <TrackOutline track={files[t]} className="text-foreground" />
              <div className="min-w-0 flex-1">
                {tracks.find((x) => x.id === t)?.name ?? t}
                <small className="block text-[11.5px] text-muted-foreground">{d ? `${nameOf(d.modelId)} · seed ${d.seed + 1} · ${Math.round(d.errorLevel * 100)}%` : "no finished lap yet"}</small>
              </div>
              <span className="font-mono">{d ? lapTime(d.steps) : "–"}</span>
            </div>
          ))}
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-muted-foreground">Models</dt>
          <dd className="m-0 text-right">
            {b.modelIds.map((m) => (
              <div key={m}>{nameOf(m)}</div>
            ))}
          </dd>
          {[
            ["Seeds", b.seeds.map((x) => x + 1).join(", ")],
            ["Driver error", b.errorLevels.map((e) => `${Math.round(e * 100)}%`).join(", ")],
            ["Laps per setting", `${b.draws} with error, 1 clean`],
            ["Started", `${when(b.createdAt)} by ${b.createdBy}`],
            ...(b.endedAt ? [["Ended", when(b.endedAt)]] : []),
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          {s === "here" && (
            <>
              <Button disabled={busy} onClick={() => act(() => runner.pause(b.id))}>
                Pause
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => act(() => runner.stop(b.id))}>
                Stop
              </Button>
            </>
          )}
          {(s === "paused" || s === "interrupted") && (
            <>
              <Button variant="default" disabled={busy} onClick={() => act(() => runner.run(b))}>
                Resume
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => act(() => runner.stop(b.id))}>
                Stop
              </Button>
            </>
          )}
          {(s === "done" || s === "stopped") && (
            <Button variant="default" onClick={() => navigate(`/benchmarks?err=${errPct}`)}>
              Open in Benchmarks
            </Button>
          )}
          <Button onClick={() => navigate(`/history?batch=${b.id}`)}>Laps in History</Button>
        </div>
        {(s === "here" || s === "interrupted") && (
          <p className="m-0 text-xs text-muted-foreground">Laps run in this tab. Closing it stops the batch where it is; laps already run stay saved, and Resume picks up from there.</p>
        )}
      </div>
    </Panel>
  );
}
