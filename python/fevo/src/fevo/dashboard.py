"""Report training progress to the fevo dashboard. Standard library only.

    from fevo.dashboard import Run

    run = Run.start("solo-6 ES", method="ES", config={"pop": 64})
    for gen in range(...):
        ...
        run.metric(gen, best=best, mean=mean, clean_laps=clean)
    run.end("done")

Reads FEVO_API and FEVO_KEY from the environment. With either unset, or when
the dashboard can't be reached, it warns and carries on: training never stops
because the dashboard is down. Publish finished models with `pnpm fevo publish`
from the fevo checkout, which runs the official laps the API re-checks.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass


def _call(method: str, path: str, body: object | None = None) -> dict | None:
    api = os.environ.get("FEVO_API", "").rstrip("/")
    key = os.environ.get("FEVO_KEY")
    if not api or not key:
        return None
    req = urllib.request.Request(
        api + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read() or b"{}")
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        detail = e.read().decode(errors="replace") if isinstance(e, urllib.error.HTTPError) else str(e)
        print(f"fevo dashboard: {method} {path} failed: {detail}", file=sys.stderr)
        return None


@dataclass
class Run:
    id: str | None

    @classmethod
    def start(cls, name: str, method: str, config: dict | None = None, machine: str | None = None) -> "Run":
        body = {"name": name, "method": method, "machine": machine or socket.gethostname()}
        if config is not None:
            body["config"] = config
        out = _call("POST", "/api/runs", body)
        return cls(out["id"] if out else None)

    def metric(self, step: int, **values: float) -> None:
        """Record numbers for one generation or epoch. A step sent twice keeps the latest values."""
        if self.id:
            _call("POST", f"/api/runs/{self.id}/metrics", {"step": int(step), "values": {k: float(v) for k, v in values.items()}})

    def end(self, status: str = "done", best_model_id: str | None = None) -> None:
        """status: done, failed or stopped."""
        if self.id:
            body: dict = {"status": status}
            if best_model_id:
                body["bestModelId"] = best_model_id
            _call("PATCH", f"/api/runs/{self.id}", body)
