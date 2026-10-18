import { useState } from "react";
import { HZ, lapTime } from "../lib/format";

/** A lap time from simulator steps. `lead` marks the board leader, `fast` the fastest single lap. */
export function LapTime({ steps, lead, fast }: { steps: number; lead?: boolean; fast?: boolean }) {
  return <span className={`lap-time${lead ? " lead" : ""}${fast ? " fast" : ""}`}>{lapTime(steps)}</span>;
}

/** Gap to the leader in seconds, with a bar scaled against the slowest entry. */
export function GapBar({ steps, best, worst }: { steps: number; best: number; worst: number }) {
  if (steps === best) return <span className="gap-bar">Leader</span>;
  const pct = worst > best ? Math.max(3, ((steps - best) / (worst - best)) * 100) : 0;
  return (
    <span className="gap-bar">
      +{((steps - best) / HZ).toFixed(2)}
      <i aria-hidden="true">
        <b style={{ width: `${pct}%` }} />
      </i>
    </span>
  );
}

export type Theme = "dark" | "light";
const THEME_KEY = "fevo.theme";

/** Flips between the dark and light themes and remembers the choice. index.html applies it before first paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          /* storage blocked: the choice lasts for this page only */
        }
        setTheme(next);
      }}
    >
      {next === "light" ? "Light mode" : "Dark mode"}
    </button>
  );
}
