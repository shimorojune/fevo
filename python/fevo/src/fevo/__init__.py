"""fevo: train agents locally on the exact simulator the website scores with.

The physics, sensors, lap rules and network evaluation all run inside the
same sim.wasm as the website and the verification server, so a lap here is
bit-identical to a lap there.
"""

__version__ = "0.1.0"

from .data import Rules, Track, load_rules, load_track, reference, track_ids  # noqa: E402
from .env import Env, make  # noqa: E402
from .program import AgentError, Program, from_json, from_neat, neat_to_json  # noqa: E402
from .replay import write_replay  # noqa: E402
from .sim import LapResult, OfficialResult, Practice, Simulator, evaluate, format_lap_time, summarize_official  # noqa: E402

__all__ = [
    "AgentError", "Env", "LapResult", "OfficialResult", "Practice", "Program", "Rules", "Simulator", "Track",
    "evaluate", "format_lap_time", "from_json", "from_neat", "load_rules", "load_track", "make", "reference", "neat_to_json",
    "summarize_official", "track_ids", "write_replay",
]  # fmt: skip
