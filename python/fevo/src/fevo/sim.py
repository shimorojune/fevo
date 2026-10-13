"""The simulator: rules, a track, an agent, laps. Same wasm as the website."""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Literal

from ._wasm import Core
from .data import Rules, Track, load_rules, load_track
from .program import Program

STATUS = ["running", "finished", "crashed", "stopped", "error", "timed-out"]
Status = Literal["running", "finished", "crashed", "stopped", "error", "timed-out"]


@dataclass
class LapResult:
    seed: int
    status: Status
    steps: int
    gates_passed: int
    gate_count: int
    hash: str
    trace: dict[str, list[float]] | None = None

    @property
    def finished(self) -> bool:
        return self.status == "finished"

    @property
    def seconds(self) -> float:
        return self.steps / 60.0


@dataclass
class OfficialResult:
    laps: list[LapResult]
    median_steps: int | None
    ranked: bool
    agent_hz: int = 60

    @property
    def lap_time(self) -> str | None:
        return None if self.median_steps is None else format_lap_time(self.median_steps, self.agent_hz)


def format_lap_time(steps: int, agent_hz: int = 60) -> str:
    cs = round(steps / agent_hz * 100)
    return f"{cs // 6000}:{(cs % 6000) / 100:05.2f}"


def summarize_official(laps: list[LapResult], agent_hz: int = 60) -> OfficialResult:
    """The website's ranking rule: median of three, unfinished laps count as slowest."""
    finished = sorted(l.steps for l in laps if l.finished)
    ranked = len(finished) >= 2
    return OfficialResult(laps, finished[1] if ranked else None, ranked, agent_hz)


@dataclass
class Practice:
    """Training-only settings. Official laps always use the defaults."""

    #: Throttle is cut above this forward speed (m/s). None means no limit.
    speed_limit: float | None = None
    #: Override the rules' step limit for one episode.
    max_steps: int | None = None


class Simulator:
    """One simulator. Create one per process (they're cheap); not thread-safe."""

    def __init__(self, rules: Rules | str = "solo-1") -> None:
        self.core = Core()
        self.rules = load_rules(rules) if isinstance(rules, str) else rules
        self.track: Track | None = None
        self.program: Program | None = None
        self._status = {name: self.core.global_value(f"STATUS_{name.upper().replace('-', '_')}") for name in STATUS}
        self.configure()

    # ---------------------------------------------------------------- setup

    def configure(self, practice: Practice | None = None) -> None:
        """Apply the rules, plus optional practice settings (None = official)."""
        r = self.rules.raw
        packed = r["carParamsPacked"]
        self.core.write_f64(packed)
        self.core.call("setCarParamsFromScratch", len(packed))
        self.core.call("setTiming", r["timing"]["agentHz"], r["timing"]["physicsSubsteps"])
        p = practice or Practice()
        self.core.call("setLimits", p.max_steps or r["timing"]["maxSteps"], float(r["timing"]["stopSpeedMps"]), r["timing"]["stopSteps"])
        s = r["sensors"]
        self.core.call("setSensors", s["rayCount"], float(s["rayLengthM"]), float(s["rayFovRad"]), float(s["speedNormMps"]))
        self.core.call("setSpeedLimit", float(p.speed_limit or 0.0))

    def load_track(self, track: Track | str) -> Track:
        t = load_track(track) if isinstance(track, str) else track
        if t is self.track:
            return t
        raw = t.raw
        n = len(raw["widthLeft"])
        self.core.write_f64(raw["centerline"] + raw["widthLeft"] + raw["widthRight"])
        self.core.write_i32(raw["gates"])
        self.core.call("loadTrackFromScratch", n, len(raw["gates"]))
        self.track = t
        return t

    def load_program(self, program: Program) -> None:
        p = program.packed()
        self.core.write_i32(p["io"] + p["nodeInts"] + p["linkSlots"])
        self.core.write_f64(p["nodeFloats"] + p["linkWeights"])
        self.core.call("loadAgentFromScratch", p["slotCount"], len(p["io"]), len(program.nodes), len(p["linkSlots"]))
        self.program = program

    # ---------------------------------------------------------------- driving

    def reset(self, seed: int = 1, *, point: int | None = None, lateral_m: float | None = None,
              heading_rad: float | None = None, speed: float | None = None) -> list[float]:
        """Start a lap. `seed` picks an official start nudge; `point` (practice) starts at any centreline point."""
        nudge = self.rules.seeds[seed] if 0 <= seed < len(self.rules.seeds) else {"lateralM": 0.0, "headingRad": 0.0}
        lat = nudge["lateralM"] if lateral_m is None else lateral_m
        hdg = nudge["headingRad"] if heading_rad is None else heading_rad
        v = self.rules.raw["start"]["initialSpeedMps"] if speed is None else speed
        if point is None:
            self.core.call("resetAtStart", float(lat), float(hdg), float(v))
        else:
            self.core.call("resetAtPoint", int(point), float(lat), float(hdg), float(v))
        return self.observation()

    def step(self, steer: float, throttle: float) -> Status:
        return STATUS[self.core.call("step", float(steer), float(throttle))]

    def step_fast(self, steer: float, throttle: float) -> tuple[int, tuple[float, ...]]:
        """One step for training loops: (status code, observation + vx, vy, yaw rate, progress index, gates, steps).

        Status codes index fevo.sim.STATUS. One wasm call and one memory read per step.
        """
        code = self.core.call("stepToScratch", float(steer), float(throttle))
        n = len(self.rules.observation) + 6
        raw = self.core.memory.read(self.core.store, self.core.f64_ptr, self.core.f64_ptr + 8 * n)
        return code, struct.unpack(f"<{n}d", bytes(raw))

    def agent_step(self) -> Status:
        return STATUS[self.core.call("agentStep")]

    def run_agent_lap(self) -> Status:
        """Drive the loaded program until the lap ends, entirely inside the wasm."""
        return STATUS[self.core.call("runAgentLap")]

    def evaluate_program(self, inputs: list[float]) -> tuple[float, float]:
        """Run the loaded program once on any inputs (inside the wasm): (steer, throttle) before clamping."""
        self.core.write_f64(inputs)
        self.core.call("evaluateAgentFromScratch", len(inputs))
        return self.core.call("getAgentSteer"), self.core.call("getAgentThrottle")

    def observation(self) -> list[float]:
        n = len(self.rules.observation)
        get = self.core.call
        return [get("getObservation", i) for i in range(n)]

    # ---------------------------------------------------------------- state

    @property
    def status(self) -> Status:
        return STATUS[self.core.call("getStatus")]

    @property
    def steps(self) -> int:
        return self.core.call("getSteps")

    @property
    def gates_passed(self) -> int:
        return self.core.call("getGatesPassed")

    @property
    def progress_index(self) -> int:
        return self.core.call("getProgressIndex")

    def pose(self) -> tuple[float, float, float, float]:
        """x, y (m), yaw (rad), forward speed (m/s)."""
        c = self.core.call
        return c("getX"), c("getY"), c("getYaw"), c("getVx")

    def state_hash(self) -> str:
        return f"{self.core.call('stateHash') & 0xFFFFFFFFFFFFFFFF:016x}"

    # ---------------------------------------------------------------- laps

    def run_lap(self, seed: int, *, trace: bool = False) -> LapResult:
        self.reset(seed)
        tr: dict[str, list[float]] | None = None
        if trace:
            c = self.core.call
            tr = {k: [] for k in ("x", "y", "yaw", "speed", "steer", "throttle", "gates")}

            def record() -> None:
                tr["x"].append(c("getX"))
                tr["y"].append(c("getY"))
                tr["yaw"].append(c("getYaw"))
                tr["speed"].append(c("getVx"))
                tr["steer"].append(c("getAgentSteer"))
                tr["throttle"].append(c("getAgentThrottle"))
                tr["gates"].append(c("getGatesPassed"))

            record()
            status = "running"
            while status == "running":
                status = self.agent_step()
                record()
        else:
            self.run_agent_lap()
        assert self.track is not None
        return LapResult(seed, self.status, self.steps, self.gates_passed, len(self.track.gates), self.state_hash(), tr)


def evaluate(program: Program, track: Track | str, rules: Rules | str = "solo-1", sim: Simulator | None = None) -> OfficialResult:
    """The three official laps and the website's ranking rule."""
    sim = sim or Simulator(rules)
    sim.configure()
    sim.load_track(track)
    sim.load_program(program)
    return summarize_official([sim.run_lap(s) for s in range(len(sim.rules.seeds))], sim.rules.agent_hz)
