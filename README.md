# fevo

Upload a neural network, get a lap time you can trust. Agents (NEAT genome or MLP, as JSON) drive real-scale circuits on one deterministic simulator. The browser runs laps for instant feedback, the server re-runs them with the same build, and only exact step-count matches are ranked.

Design: [docs/design/evracer.html](docs/design/evracer.html). Decisions: [docs/decisions.md](docs/decisions.md).

## Layout

| Path | What |
|---|---|
| `apps/web` | The site: Vite + React. Circuits, upload, replay and rules; laps run in a Web Worker on the same wasm. `pnpm --filter @fevo/web dev` |
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

Planned next: `apps/api` and the verifier (server re-runs), leaderboard, `tools/golden`, publishing the Python package.

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
