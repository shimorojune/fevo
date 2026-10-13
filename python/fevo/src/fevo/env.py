"""A gym-style environment for step-by-step training (PPO, your own loop).

    env = fevo.make("spielberg")
    obs, info = env.reset(seed=0)
    obs, reward, terminated, truncated, info = env.step([steer, throttle])

Observation and lap rules are the website's. The reward is yours to change:
the default pays for metres of progress along the centre line and gates, and
charges for crashing. It never affects official times.
"""

from __future__ import annotations

from typing import Any, Callable

from .data import Track
from .sim import Practice, Simulator

Reward = Callable[[dict[str, Any]], float]


def default_reward(i: dict[str, Any]) -> float:
    r = 0.1 * i["progress_m"] + 1.0 * i["new_gates"]
    if i["status"] == "finished":
        r += 100.0
    elif i["status"] in ("crashed", "stopped", "error"):
        r -= 10.0
    return r


class Env:
    def __init__(self, track: Track | str, rules: str = "solo-1", practice: Practice | None = None, reward: Reward = default_reward) -> None:
        self.sim = Simulator(rules)
        self.sim.configure(practice)
        self.track = self.sim.load_track(track)
        self.reward_fn = reward
        self._idx = 0
        self._gates = 0

    def reset(self, seed: int = 1, point: int | None = None, speed: float | None = None) -> tuple[list[float], dict[str, Any]]:
        obs = self.sim.reset(seed, point=point, speed=speed)
        self._idx = self.sim.progress_index
        self._gates = self.sim.gates_passed
        return obs, {"status": "running", "steps": 0, "gates_passed": self._gates}

    def step(self, action: tuple[float, float] | list[float]) -> tuple[list[float], float, bool, bool, dict[str, Any]]:
        status = self.sim.step(float(action[0]), float(action[1]))
        idx = self.sim.progress_index
        n = self.track.points
        moved = (idx - self._idx + n // 2) % n - n // 2  # signed, handles wrap
        gates = self.sim.gates_passed
        info = {
            "status": status,
            "steps": self.sim.steps,
            "gates_passed": gates,
            "new_gates": gates - self._gates,
            "progress_m": moved * self.track.raw["spacingM"],
        }
        self._idx, self._gates = idx, gates
        terminated = status in ("finished", "crashed", "stopped", "error")
        truncated = status == "timed-out"
        return self.sim.observation(), self.reward_fn(info), terminated, truncated, info


def make(track: str, rules: str = "solo-1", **kwargs: Any) -> Env:
    return Env(track, rules, **kwargs)
