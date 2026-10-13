import type { LapResult } from "@fevo/sim";
import { SOLO_1 as R } from "@fevo/rules";
import { STATUS_LABEL, lapTime } from "../lib/format";

/** The three official laps with the median marked; click a row to replay it. */
export function LapsTable({ laps, medianSteps, selected, onSelect }: { laps: LapResult[]; medianSteps: number | null; selected?: number; onSelect?: (seed: number) => void }) {
  const medianSeed = medianSteps === null ? -1 : laps.find((l) => l.status === "finished" && l.steps === medianSteps)?.seed ?? -1;
  return (
    <table>
      <thead>
        <tr>
          <th>Start</th>
          <th>Steps</th>
          <th>Time</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {R.seeds.map((_, seed) => {
          const l = laps.find((x) => x.seed === seed);
          return (
            <tr
              key={seed}
              onClick={() => l && onSelect?.(seed)}
              style={{ cursor: l && onSelect ? "pointer" : undefined, background: selected === seed ? "var(--blue-soft)" : undefined }}
            >
              <td>
                Seed {seed + 1}
                {seed === medianSeed ? <span className="muted">, median</span> : null}
              </td>
              <td className="mono">{l ? l.steps.toLocaleString() : ""}</td>
              <td className="mono">{l?.status === "finished" ? lapTime(l.steps) : l ? "–" : ""}</td>
              <td>
                {l ? (
                  <span className={`pill ${l.status === "finished" ? "ok" : "bad"}`}>
                    {STATUS_LABEL[l.status]}
                    {l.status !== "finished" ? ` at gate ${l.gatesPassed}` : ""}
                  </span>
                ) : (
                  <span className="pill run">
                    <span className="dot" /> Waiting
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
