"""Write the self-contained replay page (the same viewer as tools/replay)."""

from __future__ import annotations

import json
from importlib import resources
from pathlib import Path

from .data import Rules, branding, circuit_name, load_rules, load_track
from .program import Program
from .sim import Simulator, summarize_official


def write_replay(agents: list[tuple[str, Program]], out: str | Path, tracks: list[str] | None = None, rules: Rules | str = "solo-1") -> Path:
    r = load_rules(rules) if isinstance(rules, str) else rules
    tracks = tracks or [c["id"] for c in branding()["circuits"]]
    teams = branding()["teams"]
    sim = Simulator(r)
    laps = []
    for ai, (name, program) in enumerate(agents):
        team = teams[ai % len(teams)]
        for tid in tracks:
            sim.configure()
            sim.load_track(tid)
            sim.load_program(program)
            official = summarize_official([sim.run_lap(s) for s in range(len(r.seeds))], r.agent_hz)
            finished = sorted((l for l in official.laps if l.finished), key=lambda l: l.steps)
            seed = finished[1].seed if official.ranked else 1
            lap = sim.run_lap(seed, trace=True)
            t = lap.trace or {}
            rnd = lambda xs, k: [round(v * k) / k for v in xs]  # noqa: E731
            laps.append({
                "agent": name, "circuitId": tid, "team": {"name": team["real"]["name"], "colors": team["real"]["colors"]},
                "seed": seed, "status": lap.status, "steps": lap.steps, "gatesPassed": lap.gates_passed,
                "official": [{"seed": l.seed, "status": l.status, "steps": l.steps} for l in official.laps],
                "medianSteps": official.median_steps,
                "x": rnd(t["x"], 100), "y": rnd(t["y"], 100), "yaw": rnd(t["yaw"], 10000), "speed": rnd(t["speed"], 100),
                "steer": rnd(t["steer"], 1000), "throttle": rnd(t["throttle"], 1000), "gates": t["gates"],
                "frontSlide": rnd(t["frontSlide"], 100), "rearSlide": rnd(t["rearSlide"], 100),
            })  # fmt: skip
    data = {
        "rules": {"id": r.id, "agentHz": r.agent_hz, "car": {"length": r.car["lengthM"], "width": r.car["widthM"]}},
        "tracks": [
            {"id": tid, "name": circuit_name(tid), "location": "", "lengthM": load_track(tid).length_m,
             "centerline": load_track(tid).raw["centerline"], "widthLeft": load_track(tid).raw["widthLeft"],
             "widthRight": load_track(tid).raw["widthRight"], "gates": load_track(tid).gates}
            for tid in tracks
        ],
        "laps": laps,
    }  # fmt: skip
    template = resources.files("fevo").joinpath("_data/viewer.html").read_text("utf-8")
    html = template.replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")).replace("<", "\\u003c"))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, "utf-8")
    return out
