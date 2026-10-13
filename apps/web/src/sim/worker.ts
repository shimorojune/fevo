/// <reference lib="webworker" />
/**
 * Runs the simulator off the main thread. Everything that decides a lap
 * (physics, sensors, the network) runs inside the wasm, exactly as on the
 * server.
 */
import { fingerprint, parameterCount, parseAgent } from "@fevo/agent-format";
import { SOLO_1 as R } from "@fevo/rules";
import type { LapResult } from "@fevo/sim";
import { loadTrackFile } from "../lib/tracks";
import type { Request, Response } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

// @fevo/sim instantiates the wasm with a top-level await. Importing it
// statically would delay installing onmessage, and messages that arrive
// before then are lost, so load it on first use instead.
const simModule = import("@fevo/sim");
const post = (m: Response, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, trackId, agentText } = e.data;
  try {
    const t0 = performance.now();
    const parsed = parseAgent(agentText, { inputs: R.observation.length, outputs: R.action.length, setup: R.setup });
    if (!parsed.ok) return post({ id, type: "checked", ok: false, errors: parsed.errors, ms: performance.now() - t0 });
    const p = parsed.program;
    post({
      id,
      type: "checked",
      ok: true,
      ms: performance.now() - t0,
      summary: {
        kind: p.kind,
        nodes: p.nodes.length + p.inputSlots.length,
        connections: p.nodes.reduce((a, n) => a + n.links.length, 0),
        parameters: parameterCount(p),
        fingerprint: await fingerprint(p),
        bytes: new TextEncoder().encode(agentText).length,
        setup: p.setup ?? [],
      },
    });

    const { configure, loadAgent, loadTrack, runLap, summarizeOfficial } = await simModule;
    const track = await loadTrackFile(trackId);
    configure(R, p.setup);
    loadTrack(track);
    loadAgent(p);
    const laps: LapResult[] = [];
    for (let seed = 0; seed < R.seeds.length; seed++) {
      const lap = { ...runLap(R, seed, { trace: true }), gateCount: track.gates.length };
      laps.push(lap);
      const t = lap.trace!;
      // Structured clone copies, so the worker keeps nothing it still needs.
      post({ id, type: "lap", lap: { ...lap, trace: { ...t } } }, [t.x.buffer, t.y.buffer, t.yaw.buffer, t.speed.buffer, t.steer.buffer, t.throttle.buffer, t.gates.buffer]);
    }
    const s = summarizeOfficial(laps.map(({ trace: _t, ...l }) => l));
    post({ id, type: "done", medianSteps: s.medianSteps, ranked: s.ranked });
  } catch (err) {
    post({ id, type: "failed", message: err instanceof Error ? err.message : String(err) });
  }
};
