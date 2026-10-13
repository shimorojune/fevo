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
        return self.raw["car"]


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
