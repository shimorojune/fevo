import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "@/components/AppShell";
import { TrackOutline } from "@/components/TrackOutline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Segmented } from "@/components/ui/segmented";
import { api, useApi, type Drive, type ModelStatus, type ModelSummary } from "@/lib/api";
import { lapTime, STATUS_LABEL } from "@/lib/format";
import { useLive } from "@/lib/live";
import { useAllTracks } from "@/lib/useTrack";
import { cn } from "@/lib/utils";

const STATUS: Record<ModelStatus, string> = { house: "House", candidate: "Candidate", archived: "Archived" };
type Filter = "active" | "archived" | "all";

export function Models() {
  const models = useApi(api.models, "models");
  const tracks = useApi(api.tracks, "tracks");
  const drives = useApi(() => api.drives({ limit: 2000 }), "drives");
  const files = useAllTracks(tracks.data?.map((t) => t.id) ?? []);
  const [filter, setFilter] = useState<Filter>("active");
  const [picked, setPicked] = useState<string>();
  const [error, setError] = useState<string>();
  useLive((e) => {
    if (e.type === "model") models.setData((l) => (l ? [e.model, ...l.filter((m) => m.id !== e.model.id)] : l));
    if (e.type === "drive") drives.setData((l) => (l ? [e.drive, ...l] : l));
  });

  const list = (models.data ?? []).filter((m) => (filter === "all" ? true : filter === "archived" ? m.status === "archived" : m.status !== "archived"));
  const selected = list.find((m) => m.id === picked) ?? list[0];
  // Fastest median clean lap per track among the models shown: purple, as on a timing screen.
  const fastest = useMemo(() => {
    const out: Record<string, number> = {};
    for (const m of list) for (const [t, b] of Object.entries(m.benchmark)) if (b.medianSteps !== null) out[t] = Math.min(out[t] ?? Infinity, b.medianSteps);
    return out;
  }, [list]);
  const runsOf = (id: string) => (drives.data ?? []).filter((d) => d.modelId === id);

  const setStatus = (m: ModelSummary, status: ModelStatus) =>
    api.updateModel(m.id, { status }).then((u) => models.setData((l) => l?.map((x) => (x.id === u.id ? { ...x, ...u } : x.status === "house" && status === "house" ? { ...x, status: "candidate" } : x))), (e: Error) => setError(e.message));

  return (
    <>
      <PageHead title="Models" sub={<>Median of each model's three official laps per track, re-run by the server. Fastest on each track in purple. Models arrive from training with <span className="font-mono">fevo publish</span>.</>}>
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
            { value: "all", label: "All" },
          ]}
        />
      </PageHead>
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_360px] gap-4 pb-4 max-[980px]:grid-cols-1">
        <Panel>
          {(models.error ?? tracks.error ?? error) && <p className="m-0 px-4 py-3 text-[13px] text-destructive">{models.error ?? tracks.error ?? error}</p>}
          <div className="scroll-panel">
            {models.data && list.length === 0 ? (
              <div className="p-6 text-[13px]">
                <b className="font-medium">{filter === "archived" ? "No archived models" : "No models yet"}</b>
                <p className="mt-1 mb-0 text-muted-foreground">
                  Publish one from the training Mac with <code className="rounded-xs bg-muted px-1 font-mono">fevo publish winners/model.json</code>. It shows up here once the server has re-run its laps.
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-[13px]">
                <thead className="sticky top-0 z-10 bg-background">
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 text-left font-normal">Model</th>
                    <th className="px-3 py-2.5 text-left font-normal">Status</th>
                    {tracks.data?.map((t) => (
                      <th key={t.id} className="px-3 py-2.5 text-right align-bottom font-normal">
                        <TrackOutline track={files[t.id]} w={34} h={22} className="mb-1 ml-auto block text-foreground" />
                        {t.name}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-right font-normal">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((m) => (
                    <tr key={m.id} onClick={() => setPicked(m.id)} className={cn("cursor-pointer border-t border-border transition-colors first:border-t-0 hover:bg-muted", selected?.id === m.id && "bg-selected hover:bg-selected")}>
                      <td className="px-3 py-[11px]">
                        <span className="font-medium">{m.name}</span>
                        <small className="block text-[11.5px] text-muted-foreground">
                          {m.kind === "mlp" ? "MLP" : "NEAT"} · {m.parameters.toLocaleString()} params · {m.fingerprint.slice(0, 6)}
                        </small>
                      </td>
                      <td className="px-3 py-[11px]">
                        <Badge tone={m.status === "house" ? "house" : "neutral"}>{STATUS[m.status]}</Badge>
                      </td>
                      {tracks.data?.map((t) => {
                        const b = m.benchmark[t.id];
                        return (
                          <td key={t.id} className="px-3 py-[11px] text-right font-mono">
                            {b?.medianSteps != null ? <span className={cn(b.medianSteps === fastest[t.id] && "font-medium text-sector-purple-text")}>{lapTime(b.medianSteps)}</span> : <span className="text-muted-foreground">–</span>}
                            <small className="block text-[11.5px] text-muted-foreground">{b ? `${b.finished}/${b.total} finished` : "not run"}</small>
                          </td>
                        );
                      })}
                      <td className="px-3 py-[11px] text-right font-mono">{runsOf(m.id).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>
        {selected && <ModelInspector key={selected.id} m={selected} tracks={tracks.data ?? []} files={files} runs={runsOf(selected.id)} onStatus={(s) => void setStatus(selected, s)} />}
      </div>
    </>
  );
}

function ModelInspector({ m, tracks, files, runs, onStatus }: { m: ModelSummary; tracks: { id: string; name: string; expertLapS: number | null }[]; files: Record<string, import("@fevo/tracks").TrackFile>; runs: Drive[]; onStatus: (s: ModelStatus) => void }) {
  return (
    <Panel className="animate-fade">
      <PanelHeader>
        <h2>{m.name}</h2>
        <Badge tone={m.status === "house" ? "house" : "neutral"}>{STATUS[m.status]}</Badge>
      </PanelHeader>
      <div className="scroll-panel flex flex-col gap-[18px] px-4 py-3.5 [&>*]:animate-rise">
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          {[
            ["Kind", m.kind === "mlp" ? "MLP" : "NEAT"],
            ["Parameters", m.parameters.toLocaleString()],
            ["Fingerprint", m.fingerprint.slice(0, 12)],
            ["Rules", m.rulesId],
            ["Published", new Date(m.createdAt).toLocaleDateString()],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="m-0 text-right font-mono">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="mt-0 mb-2 text-xs text-muted-foreground">Official laps, median of three</p>
          {tracks.map((t) => {
            const b = m.benchmark[t.id];
            const off = b?.medianSteps != null && t.expertLapS ? ((b.medianSteps / 60 - t.expertLapS) / t.expertLapS) * 100 : null;
            return (
              <div key={t.id} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
                <TrackOutline track={files[t.id]} w={40} h={26} className="text-foreground" />
                <div className="min-w-0 flex-1 text-[13px]">
                  {t.name}
                  <small className="block text-[11.5px] text-muted-foreground">{off !== null ? `${off.toFixed(1)}% off the expert lap` : b ? `${b.finished}/${b.total} finished` : "not run"}</small>
                </div>
                <span className="font-mono text-[13px]">{b?.medianSteps != null ? lapTime(b.medianSteps) : "–"}</span>
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="default" asChild>
            <Link to={`/run?model=${encodeURIComponent(m.id)}`}>Run this model</Link>
          </Button>
          {m.status !== "house" && <Button onClick={() => onStatus("house")}>Make house</Button>}
          {m.status === "archived" ? <Button variant="ghost" onClick={() => onStatus("candidate")}>Restore</Button> : <Button variant="ghost" onClick={() => onStatus("archived")}>Archive</Button>}
        </div>
        <div>
          <p className="mt-0 mb-2 text-xs text-muted-foreground">Latest runs</p>
          {runs.length === 0 && <p className="m-0 text-[12.5px] text-muted-foreground">None yet. Runs you make from Run show up here.</p>}
          {runs.slice(0, 6).map((d) => (
            <Link key={d.id} to={`/run?drive=${d.id}`} className="flex items-center justify-between gap-3 border-t border-border py-2 text-[13px] first:border-t-0 hover:text-foreground">
              <span>
                {tracks.find((t) => t.id === d.trackId)?.name ?? d.trackId}
                <small className="block text-[11.5px] text-muted-foreground">
                  {new Date(d.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · seed {d.seed + 1} · {Math.round(d.errorLevel * 100)}% error
                </small>
              </span>
              <span className={cn("font-mono", d.status !== "finished" && "text-destructive")}>{d.lapTime ?? STATUS_LABEL[d.status] ?? d.status}</span>
            </Link>
          ))}
        </div>
      </div>
    </Panel>
  );
}
