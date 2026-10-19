import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHead } from "@/components/AppShell";
import { F1Key, F1Time } from "@/components/lap/Sectors";
import { TrackOutline } from "@/components/TrackOutline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader, Pick } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { api, useApi, type Drive } from "@/lib/api";
import { HZ, lapTime, STATUS_LABEL } from "@/lib/format";
import { colours, timesOf, type Colours } from "@/lib/lap";
import { useLive } from "@/lib/live";
import { useAllTracks } from "@/lib/useTrack";
import { cn } from "@/lib/utils";

type Result = "all" | "finished" | "crashed";
const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ResultBadge({ d }: { d: Drive }) {
  return d.status === "finished" ? <Badge tone="ok">Finished</Badge> : <Badge tone="bad">{STATUS_LABEL[d.status] ?? d.status}</Badge>;
}

/** Every lap run from Run, newest first. Runs are kept; nothing is overwritten. */
export function History() {
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const drives = useApi(() => api.drives({ limit: 2000 }), "drives");
  const files = useAllTracks(tracks.data?.map((t) => t.id) ?? []);
  const [model, setModel] = useState("");
  const [track, setTrack] = useState("");
  const [res, setRes] = useState<Result>("all");
  const [picked, setPicked] = useState<number>();
  const [fresh, setFresh] = useState<number>();
  useLive((e) => {
    if (e.type === "drive") {
      drives.setData((l) => (l ? [e.drive, ...l.filter((d) => d.id !== e.drive.id)] : l));
      setFresh(e.drive.id);
    }
  });

  const all = drives.data ?? [];
  const list = all.filter((d) => (!model || d.modelId === model) && (!track || d.trackId === track) && (res === "all" || (res === "finished" ? d.status === "finished" : d.status !== "finished")));
  const selected = list.find((d) => d.id === picked) ?? list[0];
  const nameOf = (id: string) => models.data?.find((m) => m.id === id)?.name ?? id;
  const kindOf = (id: string) => models.data?.find((m) => m.id === id)?.kind;
  const trackOf = (id: string) => tracks.data?.find((t) => t.id === id);

  // F1 colours for every run, judged against all runs on the same track.
  const judged = useMemo(() => {
    const out = new Map<number, Colours>();
    const times = new Map(all.map((d) => [d.id, timesOf(d.sectorEnds, d.status === "finished", d.steps)]));
    for (const d of all) {
      const same = all.filter((o) => o.trackId === d.trackId && o.id !== d.id);
      out.set(d.id, colours(times.get(d.id)!, same.filter((o) => o.modelId !== d.modelId).map((o) => times.get(o.id)!), same.filter((o) => o.modelId === d.modelId).map((o) => times.get(o.id)!)));
    }
    return out;
  }, [all]);
  const bestOf = (m: string, t: string) => Math.min(Infinity, ...all.filter((d) => d.modelId === m && d.trackId === t && d.status === "finished").map((d) => d.steps));
  const filterKey = `${model}|${track}|${res}`;

  return (
    <>
      <PageHead title="History" sub="Every lap you've run, newest first. Runs are kept; nothing is overwritten.">
        <Pick label="Model" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">All models</option>
          {models.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Pick>
        <Pick label="Track" value={track} onChange={(e) => setTrack(e.target.value)}>
          <option value="">All tracks</option>
          {tracks.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Pick>
        <Segmented<Result>
          label="Result"
          value={res}
          onChange={setRes}
          items={[
            { value: "all", label: "All" },
            { value: "finished", label: "Finished" },
            { value: "crashed", label: "Crashed" },
          ]}
        />
      </PageHead>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-4 pb-4 max-[980px]:grid-cols-1">
        <Panel>
          {drives.error && <p className="m-0 px-4 py-3 text-[13px] text-destructive">{drives.error}</p>}
          <div className="scroll-panel">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 text-left font-normal">Run</th>
                  <th className="px-3 py-2.5 text-left font-normal">Model</th>
                  <th className="px-3 py-2.5 text-left font-normal">Track</th>
                  <th className="px-3 py-2.5 text-right font-normal">Seed</th>
                  <th className="px-3 py-2.5 text-right font-normal">Driver error</th>
                  <th className="px-3 py-2.5 text-left font-normal">Result</th>
                  <th className="px-3 py-2.5 text-right font-normal">Lap</th>
                  <th className="px-3 py-2.5 text-right font-normal">To model's best</th>
                </tr>
              </thead>
              <tbody key={filterKey}>
                {list.map((d, i) => {
                  const b = bestOf(d.modelId, d.trackId);
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setPicked(d.id)}
                      style={{ animationDelay: `${Math.min(i, 5) * 20}ms` }}
                      className={cn("cursor-pointer border-t border-border animate-rise transition-colors first:border-t-0 hover:bg-muted", selected?.id === d.id && "bg-selected hover:bg-selected", fresh === d.id && "animate-fade")}
                    >
                      <td className="px-3 py-[11px]">
                        <span className="font-mono">#{d.id}</span>
                        <small className="block text-[11.5px] text-muted-foreground">{when(d.createdAt)}</small>
                      </td>
                      <td className="px-3 py-[11px]">
                        <span className="font-medium">{nameOf(d.modelId)}</span>
                        <small className="block text-[11.5px] text-muted-foreground">{kindOf(d.modelId) === "mlp" ? "MLP" : kindOf(d.modelId) ? "NEAT" : ""}</small>
                      </td>
                      <td className="px-3 py-[11px]">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <TrackOutline track={files[d.trackId]} className="text-foreground" />
                          {trackOf(d.trackId)?.name ?? d.trackId}
                        </span>
                      </td>
                      <td className="px-3 py-[11px] text-right font-mono">{d.seed + 1}</td>
                      <td className="px-3 py-[11px] text-right font-mono">{Math.round(d.errorLevel * 100)}%</td>
                      <td className="px-3 py-[11px]">
                        <ResultBadge d={d} />
                      </td>
                      <td className="px-3 py-[11px] text-right font-mono">
                        {d.status === "finished" ? <span className={cn(judged.get(d.id)?.lap === "p" && "font-medium text-sector-purple-text")}>{lapTime(d.steps)}</span> : <span className="text-muted-foreground">–</span>}
                      </td>
                      <td className="px-3 py-[11px] text-right font-mono">
                        {d.status !== "finished" ? <span className="text-muted-foreground">gate {d.gatesPassed}</span> : d.steps === b ? <span className="text-muted-foreground">best</span> : `+${((d.steps - b) / HZ).toFixed(3)}`}
                      </td>
                    </tr>
                  );
                })}
                {drives.data && list.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-muted-foreground">
                      {all.length ? (
                        "No runs match these filters."
                      ) : (
                        <>
                          No runs yet. <Link to="/run" className="text-foreground underline underline-offset-2">Run a lap</Link> and it shows up here.
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
        {selected ? <RunInspector key={selected.id} d={selected} model={nameOf(selected.modelId)} ghost={selected.ghostModelId ? nameOf(selected.ghostModelId) : null} track={trackOf(selected.trackId)} col={judged.get(selected.id)} best={bestOf(selected.modelId, selected.trackId)} /> : <Panel className="p-4 text-[13px] text-muted-foreground">Pick a run.</Panel>}
      </div>
    </>
  );
}

function RunInspector({ d, model, ghost, track, col, best }: { d: Drive; model: string; ghost: string | null; track?: { name: string; expertLapS: number | null; gatesPassed?: never } | undefined; col: Colours | undefined; best: number }) {
  const navigate = useNavigate();
  const times = timesOf(d.sectorEnds, d.status === "finished", d.steps);
  const off = track?.expertLapS ? ((d.steps / HZ - track.expertLapS) / track.expertLapS) * 100 : null;
  const again = () => navigate(`/run?${new URLSearchParams({ model: d.modelId, track: d.trackId })}`);
  return (
    <Panel className="animate-fade">
      <PanelHeader>
        <h2>Run #{d.id}</h2>
        <ResultBadge d={d} />
      </PanelHeader>
      <div className="scroll-panel flex flex-col gap-[18px] px-4 py-3.5 [&>*]:animate-rise">
        {d.status === "finished" ? (
          <>
            <div>
              <div className="text-xs text-muted-foreground">Lap time</div>
              <div className="font-mono text-[28px] font-light tracking-[-0.04em]">{lapTime(d.steps)}</div>
              <div className="text-xs text-muted-foreground">
                {[Number.isFinite(best) && d.steps !== best ? `+${((d.steps - best) / HZ).toFixed(3)} to this model's best here` : d.steps === best ? "This model's best here" : "", off !== null ? `${off.toFixed(1)}% off the expert lap` : ""].filter(Boolean).join(" · ")}
              </div>
            </div>
            {times.sec.some((x) => x !== null) && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted-foreground">Sectors</div>
                <div className="flex gap-1.5">
                  {times.sec.map((v, i) => (
                    <F1Time key={i} c={col?.sec[i]} className="flex-1 text-center">
                      {v !== null ? (v / HZ).toFixed(3) : "–"}
                    </F1Time>
                  ))}
                </div>
                <F1Key labels={["Fastest on this track", "Model's best", "Slower"]} />
              </div>
            )}
          </>
        ) : (
          <div>
            <div className="text-xs text-muted-foreground">Result</div>
            <div className="text-lg text-destructive">
              {STATUS_LABEL[d.status] ?? d.status} at gate {d.gatesPassed}
            </div>
          </div>
        )}
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {[
            ["Model", model],
            ["Track", track?.name ?? d.trackId],
            ["Seed", String(d.seed + 1)],
            ["Driver error", `${Math.round(d.errorLevel * 100)}%`],
            ["Ghost", ghost ?? "None"],
            ["Rules", d.rulesId],
            ["Simulator", d.simSha256.slice(0, 10)],
            ["Ran", `${when(d.createdAt)} by ${d.createdBy}`],
            ["Verified", d.errorLevel > 0 ? "Not checked, driver error on" : d.verified ? "Matches the server's lap" : "No server lap to match"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="default" asChild>
            <Link to={`/run?drive=${d.id}`}>Open lap view</Link>
          </Button>
          <Button onClick={again}>Run again</Button>
        </div>
        <p className="m-0 text-xs text-muted-foreground">Same model, track, seed and error level always give the same lap at 0% error; with error on, each run draws new mistakes, and this run's are kept so it replays exactly.</p>
      </div>
    </Panel>
  );
}
