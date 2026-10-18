# fevo

Train neural networks (NEAT genome or MLP, as JSON) to drive real-scale circuits on one deterministic simulator, and follow them on a private dashboard. Training publishes models and progress to the API; the dashboard lists every model and track, runs any model on any track in your browser, and shows training live.

Design: [docs/design/evracer.html](docs/design/evracer.html). Decisions: [docs/decisions.md](docs/decisions.md).

## Layout

| Path | What |
|---|---|
| `apps/api` | The dashboard's API: tracks, published models and their benchmark laps, training runs and metrics, live events (SSE), username/password sign-in, a publish key for training. Re-runs a published model's clean official laps in the same sim.wasm and refuses it unless they match. Postgres via `DATABASE_URL`, embedded PGlite otherwise. Serves the built dashboard when `WEB_DIST` is set. `pnpm --filter @fevo/api dev` |
| `apps/web` | The dashboard: Vite + React. Models, tracks, benchmarks, training and replays; laps run in a Web Worker on the same wasm. `pnpm --filter @fevo/web dev` |
| `tools/publish` | `pnpm --filter @fevo/publish fevo …`: publish a model (runs its official laps on every track first), add a track, report a training run. Python training can report progress with `fevo.dashboard.Run`. |
| `packages/rules` | Rules versions (solo-1): car params in SI units, timing, seeds, sensors. Single source of truth. |
| `packages/branding` | Every team livery and circuit display name. Flip `BRANDING_MODE` to go generic everywhere. |
| `packages/tracks` | Baked track file format; baked tracks land in `packages/tracks/data/`. |
| `packages/sim-core` | AssemblyScript simulator compiled to one `sim.wasm` for browser, Node verifier and Python. Physics, sensors, laps and network evaluation. |
| `packages/agent-format` | Validates uploaded agents (NEAT genome or MLP JSON) with user-facing errors and compiles them. See [docs/agent-format.md](docs/agent-format.md). |
| `packages/sim` | The simulator API the apps use: configure rules, load track and agent, run official laps. |
| `python/fevo` | Python SDK: the same `sim.wasm` via wasmtime, gym-style env, official evaluation, neat-python export, replay. See [python/fevo/README.md](python/fevo/README.md). |
| `tools/track-builder` | TUMFTM CSV → resampled, validated, hashed track JSON, plus an HTML preview. |
| `tools/examples` | Tunes the example agents in `examples/`. |
| `tools/replay` | Runs agents on every circuit and writes a self-contained replay page. |
| `tools/parity` | Builds the neat-python parity fixture (needs Python with neat-python 2.0). |

## Running the dashboard

```bash
pnpm --filter @fevo/api hash-password 'your password'     # prints AUTH_PASSWORD_HASH
docker build -t fevo . && docker run -p 8787:8787 \
  -e DATABASE_URL=postgres://... -e AUTH_USER=you -e AUTH_PASSWORD_HASH='scrypt$...' \
  -e SESSION_SECRET=$(openssl rand -hex 32) -e PUBLISH_KEY=$(openssl rand -hex 32) fevo
```

One container serves the API and the dashboard on one origin. Tables are created on startup, and the baked tracks are seeded into an empty database.

From the training machine:

```bash
export FEVO_API=https://your-dashboard FEVO_KEY=<PUBLISH_KEY>
pnpm --filter @fevo/publish fevo publish winners/model.json --name "solo-6 gen 412"
```

```python
from fevo.dashboard import Run
run = Run.start("solo-6 ES", method="ES", config={"pop": 64})
run.metric(gen, best=best, mean=mean)   # each generation
run.end("done")
```

## Commands

```bash
pnpm install
pnpm build          # builds sim.wasm and TS packages
pnpm test

pnpm --filter @fevo/track-builder fetch-tumftm   # download TUMFTM CSVs (LGPL-3.0)
pnpm --filter @fevo/track-builder bake spielberg         # bake one circuit
pnpm --filter @fevo/track-builder preview                # render baked tracks to tools/track-builder/out/preview.html

pnpm --filter @fevo/replay-viewer replay                 # race the example agents, write tools/replay/out/replay.html
pnpm --filter @fevo/replay-viewer replay -- my-agent.json # race your own agent file(s) instead
pnpm --filter @fevo/replay-viewer serve                  # optional: serve it on http://localhost:4173
```

Requires Node 24 (tests run TypeScript directly via Node's type stripping).

## Ground rules

- SI units everywhere: metres, seconds, kilograms, radians.
- Nothing in the sim calls host `Math`; all maths lives inside the wasm.
- Never edit a published rules version or track revision. Add a new one.
- No team or circuit name, colour or logo outside `packages/branding`.
