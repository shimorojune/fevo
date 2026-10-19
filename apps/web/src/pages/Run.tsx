import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { LapView, type LapBundle } from "@/components/lap/LapView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pick } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { api, useApi, type Drive, type Model } from "@/lib/api";
import { gap, km, lapTime, STATUS_LABEL } from "@/lib/format";
import { colours, miniSectorEnds, timesOf, type LapTimes } from "@/lib/lap";
import { loadTrackFile } from "@/lib/tracks";
import { driveLap } from "@/sim/client";

const SEEDS = ["1", "2", "3"] as const;
const ERRORS = ["0", "3", "6", "10"] as const;
type Seed = (typeof SEEDS)[number];
type Err = (typeof ERRORS)[number];

interface Scenario {
  model: string;
  track: string;
  seed: Seed;
  err: Err;
  ghost: string;
}

type Info = { state: "running" | "saved" | "history" | "failed"; text: string; drive?: Drive };

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Colour a lap against every saved run on the track, plus the ghost lap just driven. */
function judge(modelId: string, me: LapTimes, drives: Drive[], extra: { modelId: string; times: LapTimes }[], skip?: number) {
  const all = [...drives.filter((d) => d.id !== skip).map((d) => ({ modelId: d.modelId, times: timesOf(d.sectorEnds, d.status === "finished", d.steps) })), ...extra];
  return colours(
    me,
    all.filter((o) => o.modelId !== modelId).map((o) => o.times),
    all.filter((o) => o.modelId === modelId).map((o) => o.times),
  );
}

export function Run() {
  const [params, setParams] = useSearchParams();
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const live = (models.data ?? []).filter((m) => m.status !== "archived");
  const [sc, setSc] = useState<Scenario>({ model: params.get("model") ?? "", track: params.get("track") ?? "", seed: "1", err: "0", ghost: "" });
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Info>();
  const [lap, setLap] = useState<LapBundle & { key: number }>();
  const agents = useRef(new Map<string, Promise<Model>>());
  const agent = (id: string) => {
    if (!agents.current.has(id)) agents.current.set(id, api.model(id).catch((e) => (agents.current.delete(id), Promise.reject(e))));
    return agents.current.get(id)!;
  };

  // Fill defaults once the lists arrive: the house model, the first track.
  useEffect(() => {
    if (!models.data || !tracks.data) return;
    setSc((s) => ({
      ...s,
      model: live.some((m) => m.id === s.model) ? s.model : (live.find((m) => m.status === "house") ?? live[0])?.id ?? "",
      track: tracks.data!.some((t) => t.id === s.track) ? s.track : tracks.data![0]?.id ?? "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.data, tracks.data]);

  const nameOf = (id: string | null | undefined) => (id ? (models.data?.find((m) => m.id === id)?.name ?? id) : null);
  const trackOf = (id: string) => tracks.data?.find((t) => t.id === id);

  async function drive(s: Scenario, opts: { noiseSeed: number; save: boolean; from?: Drive }) {
    const m = await agent(s.model);
    const g = s.ghost ? await agent(s.ghost) : undefined;
    const seed = +s.seed - 1;
    const errorLevel = +s.err / 100;
    const [laps, track, drives] = await Promise.all([
      driveLap({ rulesId: m.rulesId, trackId: s.track, seed, errorLevel, noiseSeed: opts.noiseSeed, agentText: m.agent, ghostAgentText: g?.agent, ghostRulesId: g?.rulesId }),
      loadTrackFile(s.track),
      api.drives({ track: s.track, limit: 2000 }),
    ]);
    const ends = miniSectorEnds(laps.model, track);
    const ghostEnds = laps.ghost ? miniSectorEnds(laps.ghost, track) : undefined;
    let saved = opts.from;
    if (opts.save)
      saved = await api.saveDrive({
        modelId: m.id,
        trackId: s.track,
        seed,
        errorLevel,
        noiseSeed: opts.noiseSeed,
        status: laps.model.status,
        steps: laps.model.steps,
        gatesPassed: laps.model.gatesPassed,
        hash: laps.model.hash,
        sectorEnds: ends,
        ...(g ? { ghostModelId: g.id } : {}),
      });
    const times = timesOf(ends, laps.model.status === "finished", laps.model.steps);
    const ghostTimes = laps.ghost && ghostEnds ? timesOf(ghostEnds, laps.ghost.status === "finished", laps.ghost.steps) : undefined;
    const col = judge(m.id, times, drives, ghostTimes && g && g.id !== m.id ? [{ modelId: g.id, times: ghostTimes }] : [], saved?.id);
    const ghostCol = ghostTimes && g ? judge(g.id, ghostTimes, drives, [{ modelId: m.id, times }], undefined) : undefined;
    setLap({ key: Date.now(), track, model: laps.model, ghost: laps.ghost, names: [m.name, g?.name ?? null], ends, times, col, ghostTimes, ghostCol });
    return { saved, model: laps.model };
  }

  const describe = (s: Scenario, status: string, steps: number, gates: number) => {
    const t = trackOf(s.track);
    const res = status === "finished" ? lapTime(steps) : `${(STATUS_LABEL[status] ?? status).toLowerCase()} at gate ${gates}`;
    return `${nameOf(s.model)} · ${t?.name ?? s.track} · seed ${s.seed} · ${s.err}% error · ${res}`;
  };

  async function run() {
    if (busy || !sc.model || !sc.track) return;
    setBusy(true);
    setInfo({ state: "running", text: `${nameOf(sc.model)} · ${trackOf(sc.track)?.name ?? sc.track} · seed ${sc.seed} · ${sc.err}% error` });
    try {
      // Each run with driver error draws new mistakes; at 0% the lap is the same every time.
      const noiseSeed = sc.err === "0" ? 0 : Math.floor(Math.random() * 2 ** 31);
      const { saved, model } = await drive(sc, { noiseSeed, save: true });
      setInfo({ state: "saved", drive: saved, text: describe(sc, model.status, model.steps, model.gatesPassed) });
      if (saved) setParams({ drive: String(saved.id) }, { replace: true });
    } catch (e) {
      setInfo({ state: "failed", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // Open a saved run: same model, track, seed, error and noise give the same lap again.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const id = params.get("drive");
    if (!id || opened.current === id || !models.data || !tracks.data) return;
    opened.current = id;
    if (lap && info?.drive?.id === +id) return;
    (async () => {
      setBusy(true);
      try {
        const d = await api.drive(+id);
        const s: Scenario = { model: d.modelId, track: d.trackId, seed: String(d.seed + 1) as Seed, err: String(Math.round(d.errorLevel * 100)) as Err, ghost: d.ghostModelId ?? "" };
        setSc(s);
        setInfo({ state: "running", text: `Run #${d.id} · loading` });
        await drive(s, { noiseSeed: d.noiseSeed, save: false, from: d });
        setInfo({ state: "history", drive: d, text: describe(s, d.status, d.steps, d.gatesPassed) });
      } catch (e) {
        setInfo({ state: "failed", text: (e as Error).message });
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, models.data, tracks.data]);

  const t = trackOf(sc.track);
  const gapText = lap?.ghost && lap.model.status === "finished" && lap.ghost.status === "finished" ? `${gap(lap.ghost.steps, lap.model.steps)} to ${lap.names[0]}` : "";
  const err = models.error ?? tracks.error;

  return (
    <>
      <div className="flex flex-col gap-2 py-3">
        <form
          className="flex flex-wrap items-center gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <h1 className="m-0 mr-2 text-xl leading-tight font-medium tracking-[-0.025em]">Run</h1>
          <Pick label="Model" value={sc.model} onChange={(e) => setSc((s) => ({ ...s, model: e.target.value, ghost: s.ghost === e.target.value ? "" : s.ghost }))}>
            {live.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Pick>
          <Pick label="Track" value={sc.track} onChange={(e) => setSc((s) => ({ ...s, track: e.target.value }))}>
            {tracks.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Pick>
          <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
            Seed
            <Segmented<Seed> label="Seed" value={sc.seed} onChange={(v) => setSc((s) => ({ ...s, seed: v }))} items={SEEDS.map((v) => ({ value: v, label: v }))} />
          </span>
          <span className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
            Driver error
            <Segmented<Err> label="Driver error" value={sc.err} onChange={(v) => setSc((s) => ({ ...s, err: v }))} items={ERRORS.map((v) => ({ value: v, label: `${v}%` }))} />
          </span>
          <Pick label="Ghost" value={sc.ghost} onChange={(e) => setSc((s) => ({ ...s, ghost: e.target.value }))}>
            <option value="">No ghost</option>
            {live
              .filter((m) => m.id !== sc.model)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </Pick>
          <span className="flex-1" />
          <Button type="submit" variant="default" disabled={busy || !sc.model || !sc.track} className="min-w-[84px]">
            {busy && <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />}
            {busy ? "Running" : "Run lap"}
          </Button>
        </form>
        <div className="flex min-h-[30px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            {err && <span className="text-destructive">{err}</span>}
            {info && (
              <span key={info.state + info.text} className="flex animate-fade flex-wrap items-center gap-2">
                {info.state === "running" && <Badge tone="run" dot live>Running</Badge>}
                {info.state === "saved" && <Badge tone="ok" dot>Saved to history</Badge>}
                {info.state === "history" && <Badge tone="neutral">From history</Badge>}
                {info.state === "failed" && <Badge tone="bad">Failed</Badge>}
                {info.drive && <span className="font-mono">#{info.drive.id}</span>}
                {info.drive && <span>{when(info.drive.createdAt)}</span>}
                <span className={info.state === "failed" ? "text-destructive" : ""}>{info.text}</span>
                {info.drive?.verified && <span title="Matches the server's own lap for this model, track and seed">· verified</span>}
              </span>
            )}
            {!info && t && <span>{t.name} · {km(t.lengthM)}</span>}
          </div>
          {lap && (
            <div className="flex flex-wrap items-baseline gap-[22px]">
              <div className="flex items-baseline gap-2">
                <i className="h-[3px] w-3 self-center rounded-xs bg-driver-a" />
                <span className="text-[12.5px] text-muted-foreground">{lap.names[0]}</span>
                <span className="font-mono text-[22px] font-light tracking-[-0.04em]">{lap.model.status === "finished" ? lapTime(lap.model.steps) : "–"}</span>
              </div>
              {lap.ghost && (
                <div className="flex items-baseline gap-2">
                  <i className="h-[3px] w-3 self-center rounded-xs bg-driver-b" />
                  <span className="text-[12.5px] text-muted-foreground">{lap.names[1]}, ghost</span>
                  <span className="font-mono text-[22px] font-light tracking-[-0.04em]">{lap.ghost.status === "finished" ? lapTime(lap.ghost.steps) : "–"}</span>
                  <span className="font-mono text-xs text-muted-foreground">{gapText}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {lap ? (
        <LapView key={lap.key} lap={lap} />
      ) : (
        <div className="mb-4 grid place-items-center rounded-lg border border-dashed border-border p-8 text-center">
          <div className="max-w-sm animate-rise">
            <b className="font-medium">{busy ? "Driving the lap" : "Pick a scenario and run a lap"}</b>
            <p className="mt-1 mb-0 text-[13px] text-muted-foreground">
              {busy
                ? "The simulator runs in your browser, the same wasm the server uses."
                : `The lap runs in your browser and is saved to History. At 0% driver error the same model, track and seed always give the same lap; with error on, each run draws new mistakes.`}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
