"""Rules, tracks and branding shipped with the package (copied from the TypeScript build)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Any


def _read(path: str) -> Any:
    return json.loads(resources.files("fevo").joinpath(f"_data/{path}").read_text("utf-8"))


@lru_cache(maxsize=1)
def manifest() -> dict[str, Any]:
    return _read("manifest.json")


#: Rear tyre models under power; the index is the simulator's code (packages/rules/src/tyres.ts).
REAR_SLIDE_MODELS = ["drive-only", "combined-slip"]
#: Track limits; the index is the simulator's code (packages/rules/src/limits.ts).
TRACK_LIMITS = ["all-corners", "one-tyre"]


@dataclass(frozen=True)
class Rules:
    """One rules version, exactly as the website enforces it."""

    raw: dict[str, Any]

    @property
    def id(self) -> str:
        return self.raw["id"]

    @property
    def sim_version(self) -> str:
        return self.raw["simVersion"]

    @property
    def agent_hz(self) -> int:
        return self.raw["timing"]["agentHz"]

    @property
    def seeds(self) -> list[dict[str, float]]:
        return self.raw["seeds"]

    @property
    def observation(self) -> list[str]:
        return self.raw["observation"]

    @property
    def car(self) -> dict[str, float]:
        """The car at the default setup."""
        return self.raw["car"]

    @property
    def setup(self) -> list[dict[str, Any]]:
        """Setup knobs: id, label, min, max, default, help, effects."""
        return self.raw.get("setup", [])

    def car_for(self, setup: list[float] | None) -> dict[str, float]:
        """The car for a setup (values in knob order), exactly as the website computes it."""
        car = dict(self.raw["car"])
        if setup is None:
            return car
        for k, v in zip(self.setup, setup):
            for e in k["effects"]:
                car[e["param"]] = car[e["param"]] + e["perUnit"] * (v - k["default"])
        return car

    @property
    def rear_slide(self) -> tuple[int, float]:
        """The simulator's (model, sliding mu) for the rear tyres under power. No `tyres` block (solo-1) is drive-only."""
        t = self.raw.get("tyres") or {"rearSlide": "drive-only", "rearSlideMu": 1.0}
        return REAR_SLIDE_MODELS.index(t["rearSlide"]), float(t["rearSlideMu"])

    @property
    def track_limits(self) -> int:
        """The simulator's track-limits code. No `trackLimits` (solo-1, solo-2) means all four corners inside."""
        return TRACK_LIMITS.index(self.raw.get("trackLimits", "all-corners"))

    def packed_car(self, setup: list[float] | None) -> list[float]:
        car = self.car_for(setup)
        return [car[k] for k in self.raw["carParamOrder"]]


@lru_cache(maxsize=None)
def load_rules(rules_id: str = "solo-1") -> Rules:
    return Rules(_read(f"rules/{rules_id}.json"))


@dataclass(frozen=True)
class Track:
    raw: dict[str, Any]

    @property
    def id(self) -> str:
        return self.raw["circuitId"]

    @property
    def points(self) -> int:
        return len(self.raw["widthLeft"])

    @property
    def gates(self) -> list[int]:
        return self.raw["gates"]

    @property
    def length_m(self) -> float:
        return self.raw["lengthM"]

    @property
    def name(self) -> str:
        return circuit_name(self.id)


@lru_cache(maxsize=None)
def load_track(track_id: str) -> Track:
    return Track(_read(f"tracks/{track_id}.track.json"))


def track_ids() -> list[str]:
    return list(manifest()["tracks"].keys())


@lru_cache(maxsize=1)
def branding() -> dict[str, Any]:
    return _read("branding.json")


def circuit_name(track_id: str, mode: str = "real") -> str:
    for c in branding()["circuits"]:
        if c["id"] == track_id:
            return c[mode]["name"]
    return track_id


@lru_cache(maxsize=None)
def reference(track_id: str) -> dict[str, Any]:
    """Racing line (offset from the centre line, metres, left positive) and the
    reference speed at every centre-line point for the current car, plus the
    reference lap time. Computed by tools/calibrate; a guide, not a bound."""
    return _read(f"reference/{track_id}.json")
