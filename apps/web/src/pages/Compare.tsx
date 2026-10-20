import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { LapView, type LapBundle } from "@/components/lap/LapView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pick } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { api, useApi, type Drive, type Model } from "@/lib/api";
import { HZ, lapTime, STATUS_LABEL } from "@/lib/format";
import { judge, miniSectorEnds, timesOf } from "@/lib/lap";
import { useLive } from "@/lib/live";
import { loadTrackFile } from "@/lib/tracks";
import { driveLap } from "@/sim/client";

type Quick = "pick" | "fast" | "own";
const QUICK: Quick[] = ["pick", "fast", "own"];

const result = (d: Drive) => (d.status === "finished" ? lapTime(d.steps) : `${(STATUS_LABEL[d.status] ?? d.status).toLowerCase()} at gate ${d.gatesPassed}`);
const byTime = (x: Drive, y: Drive) => x.steps - y.steps || x.id - y.id;

/**
 * Any two saved runs on one track, replayed together: A drives, B is the ghost. Both laps are
 * re-run in the browser from their settings, so the replay, traces and corners are the real laps.
 */
export function Compare() {
  const [params, setParams] = useSearchParams();
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const trackId = params.get("track") ?? "";
  const aId = Number(params.get("a")) || 0;
  const bId = Number(params.get("b")) || 0;
  const q: Quick = QUICK.includes(params.get("q") as Quick) ? (params.get("q") as Quick) : "pick";
  const listed = useApi(() => (trackId ? api.drives({ track: trackId, limit: 2000 }) : Promise.resolve([] as Drive[])), `compare:${trackId}`);
  const [opened, setOpened] = useState<Drive[]>([]);
  const [none, setNone] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [lap, setLap] = useState<LapBundle & { key: string; replayed: boolean }>();
  useLive((e) => {
    if (e.type === "drive" && e.drive.trackId === trackId) listed.setData((l) => (l ? [e.drive, ...l.filter((d) => d.id !== e.drive.id)] : l));
  });

  const update = (p: Record<string, string | number | null>) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(p)) if (v === null || v === "" || v === 0) n.delete(k);
        else n.set(k, String(v));
        return n;
      },
      { replace: true },
    );

  // Where to start: the run asked for, else the latest run anywhere.
  useEffect(() => {
    if (trackId) return;
    let live = true;
    (aId ? api.drive(aId) : api.drives({ limit: 1 }).then((l) => l[0])).then(
      (d) => {
        if (!live) return;
        if (d) update({ track: d.trackId, a: d.id });
        else setNone(true);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId, aId]);

  // Runs asked for by id that are older than the list: fetch them on their own.
  useEffect(() => {
    if (!listed.data) return;
    for (const id of [aId, bId])
      if (id && !listed.data.some((d) => d.id === id) && !opened.some((d) => d.id === id))
        api.drive(id).then((d) => d.trackId === trackId && setOpened((o) => [...o, d]), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed.data, aId, bId]);

  const runs = useMemo(() => [...(listed.data ?? []), ...opened.filter((o) => o.trackId === trackId && !listed.data?.some((d) => d.id === o.id))], [listed.data, opened, trackId]);
  const fin = useMemo(() => runs.filter((d) => d.status === "finished").sort(byTime), [runs]);
  const A = runs.find((d) => d.id === aId) ?? fin[0] ?? runs[0];
  const fastest = fin.find((d) => d.id !== A?.id);
  const own = fin.find((d) => d.id !== A?.id && d.modelId === A?.modelId);
  const B = q === "fast" ? fastest : q === "own" ? own : (runs.find((d) => d.id === bId && d.id !== A?.id) ?? fastest ?? own ?? runs.find((d) => d.id !== A?.id));

  const nameOf = (id: string) => models.data?.find((m) => m.id === id)?.name ?? id;
  const trackName = tracks.data?.find((t) => t.id === trackId)?.name ?? trackId;
  const label = (d: Drive) => `${nameOf(d.modelId)} #${d.id}`;
  const agents = useRef(new Map<string, Promise<Model>>());
  const agent = (id: string) => {
    if (!agents.current.has(id)) agents.current.set(id, api.model(id).catch((e) => (agents.current.delete(id), Promise.reject(e))));
    return agents.current.get(id)!;
  };

  // Re-run both laps from their saved settings whenever the pair changes.
  const pair = A && B ? `${A.id}-${B.id}` : "";
  const runsRef = useRef(runs);
  runsRef.current = runs;
  useEffect(() => {
    if (!A || !B || !models.data) return;
    let live = true;
    setBusy(true);
    setError(undefined);
    (async () => {
      const [ma, mb, track] = await Promise.all([agent(A.modelId), agent(B.modelId), loadTrackFile(trackId)]);
      const one = (d: Drive, m: Model) => driveLap({ rulesId: m.rulesId, trackId, seed: d.seed, errorLevel: d.errorLevel, noiseSeed: d.noiseSeed, agentText: m.agent }).then((r) => r.model);
      const [la, lb] = await Promise.all([one(A, ma), one(B, mb)]);
      const ends = miniSectorEnds(la, track);
      const ghostEnds = miniSectorEnds(lb, track);
      const times = timesOf(ends, la.status === "finished", la.steps);
      const ghostTimes = timesOf(ghostEnds, lb.status === "finished", lb.steps);
      const all = runsRef.current;
      if (!live) return;
      setLap({
        key: pair,
        track,
        model: la,
        ghost: lb,
        names: [label(A), label(B)],
        ends,
        times,
        col: judge(A.modelId, times, all, [], A.id),
        ghostTimes,
        ghostCol: judge(B.modelId, ghostTimes, all, [], B.id),
        replayed: la.hash === A.hash && lb.hash === B.hash,
      });
    })()
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, models.data]);

  const group = (not?: number) =>
    [...new Set(runs.map((d) => d.modelId))].map((m) => (
      <optgroup key={m} label={nameOf(m)}>
        {runs
          .filter((d) => d.modelId === m && d.id !== not)
          .map((d) => (
            <option key={d.id} value={d.id}>
              #{d.id} · seed {d.seed + 1} · {Math.round(d.errorLevel * 100)}% · {result(d)}
            </option>
          ))}
      </optgroup>
    ));

  let line = "";
  if (A && !B) line = q === "own" ? `No other finished run of ${nameOf(A.modelId)} here.` : "Pick a second run on this track.";
  else if (A && B && A.status === "finished" && B.status === "finished") {
    const d = (B.steps - A.steps) / HZ;
    line = d === 0 ? "Dead level over the lap." : `${d > 0 ? "A" : "B"} is ${Math.abs(d).toFixed(3)} s faster over the lap.`;
  } else if (A && B) line = `${[A, B].filter((d) => d.status !== "finished").map((d) => `${d === A ? "A" : "B"} ${result(d)}`).join(", ")}; the replay and traces compare both up to there.`;
  const shown = lap && lap.key === pair ? lap : undefined;
  const err = error ?? models.error ?? tracks.error ?? listed.error;

  return (
    <>
      <div className="flex flex-col gap-2 py-3">
        <form className="flex flex-wrap items-center gap-3.5" aria-label="Runs to compare" onSubmit={(e) => e.preventDefault()}>
          <h1 className="m-0 mr-2 text-xl leading-tight font-medium tracking-[-0.025em]">Compare</h1>
          <Pick label="Track" value={trackId} onChange={(e) => update({ track: e.target.value, a: null, b: null, q: "fast" })}>
            {!trackId && <option value="" />}
            {tracks.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Pick>
          <Pick label="Run A" value={A?.id ?? ""} className="max-w-[min(300px,calc(100vw-130px))]" onChange={(e) => update({ a: +e.target.value, ...(B && +e.target.value === B.id ? { b: null } : {}) })}>
            {group()}
          </Pick>
          <Button size="sm" variant="ghost" type="button" disabled={!A || !B} title="Swap A and B" onClick={() => A && B && update({ a: B.id, b: A.id, q: "pick" })}>
            Swap
          </Button>
          <Pick label="Run B" value={B?.id ?? ""} className="max-w-[min(300px,calc(100vw-130px))]" onChange={(e) => update({ b: +e.target.value, q: "pick" })}>
            {!B && <option value="" />}
            {group(A?.id)}
          </Pick>
        </form>
        <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              B is
              <Segmented<Quick>
                label="Run B is"
                value={q}
                onChange={(v) => update({ q: v, b: v === "pick" ? (B?.id ?? null) : null })}
                items={[
                  { value: "pick", label: "Picked" },
                  { value: "fast", label: "Fastest here" },
                  { value: "own", label: "A's model best" },
                ]}
              />
            </span>
            {busy && <Badge tone="run" dot live>Re-running both laps</Badge>}
            {err && <span className="text-destructive">{err}</span>}
            {!err && A && <span>{trackName} · {line}</span>}
            {shown && !shown.replayed && <span className="text-destructive">One of these laps replays differently from when it was saved; the simulator has changed since.</span>}
          </div>
          {A && (
            <div className="flex flex-wrap items-baseline gap-[22px]">
              <div className="flex items-baseline gap-2">
                <i className="h-[3px] w-3 self-center rounded-xs bg-driver-a" />
                <span className="text-[12.5px] text-muted-foreground">A · {label(A)} · {Math.round(A.errorLevel * 100)}%</span>
                <span className="font-mono text-[22px] font-light tracking-[-0.04em]">{A.status === "finished" ? lapTime(A.steps) : "–"}</span>
              </div>
              {B && (
                <div className="flex items-baseline gap-2">
                  <i className="h-[3px] w-3 self-center rounded-xs bg-driver-b" />
                  <span className="text-[12.5px] text-muted-foreground">B · {label(B)} · {Math.round(B.errorLevel * 100)}%</span>
                  <span className="font-mono text-[22px] font-light tracking-[-0.04em]">{B.status === "finished" ? lapTime(B.steps) : "–"}</span>
                  {A.status === "finished" && B.status === "finished" && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {B.steps >= A.steps ? "+" : "−"}
                      {(Math.abs(B.steps - A.steps) / HZ).toFixed(3)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {shown ? (
        <LapView key={shown.key} lap={shown} />
      ) : (
        <div className="mb-4 grid place-items-center rounded-lg border border-dashed border-border p-8 text-center">
          <div className="max-w-sm animate-rise">
            <b className="font-medium">{none ? "No runs to compare yet" : A && B ? "Re-running both laps" : A ? "Pick a second run" : "Loading runs"}</b>
            <p className="mt-1 mb-0 text-[13px] text-muted-foreground">
              {none ? (
                <>
                  <Link to="/run" className="text-foreground underline underline-offset-2">Run a lap</Link> or start a batch, then compare any two runs on the same track here.
                </>
              ) : (
                "Both laps run again in your browser from their saved settings, so the replay, traces and corners are the real laps."
              )}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
