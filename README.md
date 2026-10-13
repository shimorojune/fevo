# fevo

Upload a neural network, get a lap time you can trust. Agents (NEAT genome or MLP, as JSON) drive real-scale circuits on one deterministic simulator. The browser runs laps for instant feedback, the server re-runs them with the same build, and only exact step-count matches are ranked.

Design: [docs/design/evracer.html](docs/design/evracer.html). Decisions: [docs/decisions.md](docs/decisions.md).

## Layout

| Path | What |
|---|---|
| `packages/rules` | Rules versions (solo-1): car params in SI units, timing, seeds, sensors. Single source of truth. |
| `packages/branding` | Every team livery and circuit display name. Flip `BRANDING_MODE` to go generic everywhere. |
| `packages/tracks` | Baked track file format; baked tracks land in `packages/tracks/data/`. |
| `packages/sim-core` | AssemblyScript simulator compiled to one `sim.wasm` for browser, Node verifier and Python. |
| `tools/track-builder` | TUMFTM CSV → resampled, validated, hashed track JSON. |

Planned next: `packages/agent-format`, `packages/render`, `apps/web`, `apps/api`, `apps/verifier`, `tools/golden`, `python/fevo-gym`.

## Commands

```bash
pnpm install
pnpm build          # builds sim.wasm and TS packages
pnpm test

pnpm --filter @fevo/track-builder fetch-tumftm   # download TUMFTM CSVs (LGPL-3.0)
pnpm --filter @fevo/track-builder bake spielberg         # bake one circuit
```

Requires Node 24 (tests run TypeScript directly via Node's type stripping).

## Ground rules

- SI units everywhere: metres, seconds, kilograms, radians.
- Nothing in the sim calls host `Math`; all maths lives inside the wasm.
- Never edit a published rules version or track revision. Add a new one.
- No team or circuit name, colour or logo outside `packages/branding`.
