/// <reference lib="webworker" />
/**
 * Runs the simulator off the main thread. Everything that decides a lap
 * (physics, sensors, the network) runs inside the wasm, exactly as on the
 * server; only driver error, when asked for, is added here between steps.
 */
import { parseAgent } from "@fevo/agent-format";
import { rulesById } from "@fevo/rules";
import type { LapResult } from "@fevo/sim";
import { miniSectorEnds } from "../lib/lap";
import { loadTrackFile } from "../lib/tracks";
import type { Request, Response } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// @fevo/sim instantiates the wasm with a top-level await. Importing it statically would delay
// installing onmessage, and messages that arrive before then are lost, so load it on first use.
const simModule = import("@fevo/sim");
const post = (m: Response, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<Request>) => {
  const r = e.data;
  try {
    const { configure, loadAgent, loadTrack, runLap } = await simModule;
    const track = await loadTrackFile(r.trackId);
    const drive = (who: "model" | "ghost", rulesId: string, agentText: string, errorLevel: number) => {
      const rules = rulesById(rulesId);
      const parsed = parseAgent(agentText, { inputs: rules.observation.length, outputs: rules.action.length, setup: rules.setup });
      if (!parsed.ok) throw new Error(`${who === "ghost" ? "The ghost" : "The model"} doesn't pass validation: ${parsed.errors[0]?.message ?? ""}`);
      configure(rules, parsed.program.setup);
      loadTrack(track);
      loadAgent(parsed.program);
      const lap: LapResult = { ...runLap(rules, r.seed, { trace: true, error: { level: errorLevel, noiseSeed: r.noiseSeed } }), gateCount: track.gates.length };
      if (r.summary) {
        const { trace: _t, ...rest } = lap;
        post({ id: r.id, type: "summary", lap: rest, ends: miniSectorEnds(lap, track) });
        return;
      }
      const t = lap.trace!;
      post({ id: r.id, type: "lap", who, lap }, [t.x.buffer, t.y.buffer, t.yaw.buffer, t.speed.buffer, t.steer.buffer, t.throttle.buffer, t.gates.buffer, t.frontSlide.buffer, t.rearSlide.buffer]);
    };
    drive("model", r.rulesId, r.agentText, r.errorLevel);
    // The ghost drives clean: it's the reference to beat.
    if (r.ghostAgentText) drive("ghost", r.ghostRulesId ?? r.rulesId, r.ghostAgentText, 0);
    post({ id: r.id, type: "done" });
  } catch (err) {
    post({ id: r.id, type: "failed", message: err instanceof Error ? err.message : String(err) });
  }
};
