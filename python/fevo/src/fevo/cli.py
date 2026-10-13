"""fevo command line: check an agent like the website does, or write a replay.

    fevo info
    fevo check my-agent.json --track spielberg
    fevo replay my-agent.json [more.json] -o replay.html
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__
from ._wasm import wasm_sha256
from .data import manifest, track_ids
from .program import AgentError, from_json
from .replay import write_replay
from .sim import evaluate, format_lap_time


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="fevo")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("info", help="simulator version and fingerprints")
    c = sub.add_parser("check", help="run the three official laps, as the website will")
    c.add_argument("agent")
    c.add_argument("--track", default="spielberg", choices=track_ids())
    r = sub.add_parser("replay", help="write a self-contained replay page")
    r.add_argument("agents", nargs="+")
    r.add_argument("-o", "--out", default="replay.html")
    r.add_argument("--track", action="append", choices=track_ids())
    a = ap.parse_args(argv)

    if a.cmd == "info":
        m = manifest()
        print(f"fevo {__version__}, simulator {m['simVersion']}, rules {', '.join(m['rules'])}")
        print(f"sim.wasm sha256 {wasm_sha256()}")
        for t, h in m["tracks"].items():
            print(f"track {t}: {h[:12]}")
        return 0

    if a.cmd == "check":
        try:
            program = from_json(Path(a.agent).read_text("utf-8"))
        except AgentError as e:
            print(f"rejected: {e}", file=sys.stderr)
            return 2
        res = evaluate(program, a.track)
        print(f"{Path(a.agent).name} on {a.track}, fingerprint {program.fingerprint()[:6]}")
        for lap in res.laps:
            t = format_lap_time(lap.steps) if lap.finished else f"{lap.status} at gate {lap.gates_passed} of {lap.gate_count}"
            print(f"  seed {lap.seed + 1}: {lap.steps:>6} steps  {t}")
        print(f"  median: {res.lap_time or 'not ranked'}")
        return 0 if res.ranked else 1

    agents = [(Path(p).name, from_json(Path(p).read_text("utf-8"))) for p in a.agents]
    out = write_replay(agents, a.out, a.track)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
