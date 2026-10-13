import { useEffect, useRef, useState } from "react";
import type { LapResult } from "@fevo/sim";
import type { TrackFile } from "@fevo/tracks";
import { SOLO_1 as R } from "@fevo/rules";
import { drawMain, drawMap, drawTelemetry, geometry, sample, type Car, type Colors } from "../lib/replay";
import { HZ, STATUS_LABEL, lapTime } from "../lib/format";

interface Props {
  track: TrackFile;
  lap: LapResult;
  colors: Colors;
  ghost?: LapResult | undefined;
  autoplay?: boolean;
}

/** Follow-cam replay with minimap, telemetry and playback controls. */
export function Replay({ track, lap, colors, ghost, autoplay = true }: Props) {
  const main = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement>(null);
  const tele = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(autoplay);
  const [rate, setRate] = useState(1);
  const [zoom, setZoom] = useState(8);
  const [, force] = useState(0);
  const frame = useRef(0);
  const state = useRef({ playing, rate, zoom });
  state.current = { playing, rate, zoom };

  const trace = lap.trace!;
  const steps = lap.steps;

  useEffect(() => {
    frame.current = 0;
    setPlaying(autoplay);
  }, [lap, autoplay]);

  useEffect(() => {
    const geo = geometry(track);
    const cars: Car[] = [{ trace, colors }];
    if (ghost?.trace) cars.push({ trace: ghost.trace, colors: { primary: "#ffffff", secondary: "#121417", accent: "#121417" }, ghost: true });
    let last = performance.now();
    let raf = 0;
    let hudTick = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = state.current;
      if (s.playing) {
        frame.current += dt * HZ * s.rate;
        if (frame.current >= steps) {
          frame.current = steps;
          setPlaying(false);
        }
      }
      if (main.current) drawMain(main.current, { geo, cars, frame: frame.current, zoom: s.zoom, car: { length: R.car.lengthM, width: R.car.widthM }, agentHz: HZ });
      if (map.current) drawMap(map.current, geo, cars, frame.current);
      if (tele.current) drawTelemetry(tele.current, trace, frame.current);
      if (++hudTick % 3 === 0) force((x) => x + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [track, trace, colors, ghost, steps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        if (frame.current >= steps) frame.current = 0;
        setPlaying((p) => !p);
      } else if (e.key === "r" || e.key === "R") {
        frame.current = 0;
        setPlaying(true);
      } else if (e.key === "ArrowRight") {
        setPlaying(false);
        frame.current = Math.min(steps, Math.floor(frame.current) + 1);
      } else if (e.key === "ArrowLeft") {
        setPlaying(false);
        frame.current = Math.max(0, Math.ceil(frame.current) - 1);
      } else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(30, z + 1));
      else if (e.key === "-") setZoom((z) => Math.max(1, z - 1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [steps]);

  const f = Math.min(frame.current, steps);
  const i = Math.floor(f);
  const thr = Math.max(-1, Math.min(1, trace.throttle[i] ?? 0));
  const str = Math.max(-1, Math.min(1, trace.steer[i] ?? 0));
  const done = f >= steps;

  return (
    <div className="replay">
      <div className="panel" style={{ overflow: "hidden" }}>
        <canvas ref={main} className="main" aria-label={`Replay of the lap on ${track.circuitId}`} />
        <canvas
          ref={tele}
          className="tele"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            frame.current = ((e.clientX - r.left) / r.width) * steps;
          }}
        />
        <div className="controls">
          <button
            className="btn small primary"
            onClick={() => {
              if (frame.current >= steps) frame.current = 0;
              setPlaying(!playing);
            }}
          >
            {playing ? "Pause" : done ? "Replay" : "Play"}
          </button>
          <button className="btn small" onClick={() => ((frame.current = 0), setPlaying(true))}>
            Restart
          </button>
          {[0.5, 1, 2, 4, 8].map((r) => (
            <button key={r} className={`btn small${rate === r ? " dark" : ""}`} onClick={() => setRate(r)}>
              {r}×
            </button>
          ))}
          <label className="row small muted" style={{ marginLeft: "auto" }}>
            Zoom
            <input type="range" min={1} max={30} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
        </div>
        <p className="tiny muted" style={{ padding: "0 12px 10px" }}>
          Space or Esc pauses, R restarts, arrow keys step one frame, + and − zoom. Click the trace to jump.
        </p>
      </div>
      <div className="stack">
        <div className="panel panel-pad stack" style={{ gap: 14 }}>
          <div className="row" style={{ gap: 24 }}>
            <div className="stat">
              <div className="k">Lap time</div>
              <div className="v">{lapTime(f)}</div>
            </div>
            <div className="stat">
              <div className="k">Speed</div>
              <div className="v sm">{Math.round(sample(trace.speed, f) * 3.6)} km/h</div>
            </div>
          </div>
          <div className="row" style={{ gap: 24 }}>
            <div className="stat">
              <div className="k">Gate</div>
              <div className="v sm">
                {trace.gates[i] ?? 0} of {track.gates.length}
              </div>
            </div>
            <div className="stat">
              <div className="k">Result</div>
              <div className="v sm" style={{ fontFamily: "inherit" }}>
                {done ? (lap.status === "finished" ? `Finished ${lapTime(steps)}` : STATUS_LABEL[lap.status]) : "Running"}
              </div>
            </div>
          </div>
          <div>
            <div className="tiny muted">Throttle / brake</div>
            <div className="bar">
              <i style={{ left: thr >= 0 ? "50%" : `${50 + thr * 50}%`, width: `${Math.abs(thr) * 50}%`, background: thr >= 0 ? "var(--green)" : "var(--red)" }} />
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              Steer, left − / right +
            </div>
            <div className="bar">
              <i style={{ left: str >= 0 ? "50%" : `${50 + str * 50}%`, width: `${Math.abs(str) * 50}%`, background: "#7c3aed" }} />
            </div>
          </div>
        </div>
        <div className="panel" style={{ padding: 8 }}>
          <canvas ref={map} className="map" aria-label="Position in lap" />
        </div>
      </div>
    </div>
  );
}
