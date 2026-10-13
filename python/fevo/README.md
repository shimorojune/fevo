# fevo (Python)

Train agents on your own machine with the exact simulator the website scores with. The package ships the same `sim.wasm` (run through wasmtime), the baked tracks and the rules, so a lap here is bit-identical to the website and the server.

```python
import fevo

# Whole-network evaluation (neuroevolution): three official laps, website ranking rule.
program = fevo.from_neat(genome, config)          # or fevo.from_json(open("agent.json").read())
result = fevo.evaluate(program, "spielberg")
print(result.lap_time, [lap.status for lap in result.laps])

# Step by step (any algorithm).
env = fevo.make("spielberg")
obs, info = env.reset(seed=1)
obs, reward, terminated, truncated, info = env.step([0.0, 1.0])

# Practice settings for curricula (never used for official times).
sim = fevo.Simulator()
sim.configure(fevo.Practice(speed_limit=20.0, max_steps=30000))
sim.load_track("monza")
sim.reset(point=1200)                                # start anywhere on the centre line
```

Command line:

```bash
fevo info                                  # simulator version, sim.wasm fingerprint
fevo check my-agent.json --track spielberg # exactly what the website will show
fevo replay my-agent.json -o replay.html   # watch it
```

Write upload files with `fevo.neat_to_json(genome, config)`.

The assets in `src/fevo/_data` are generated from the TypeScript build: run `pnpm build` at the repo root after changing the simulator, rules or tracks. `tests/test_parity.py` checks Python reproduces Node's lap hashes exactly.
