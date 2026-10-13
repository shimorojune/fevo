import json
from pathlib import Path

import fevo
from fevo.program import from_json
from fevo.sim import Simulator, summarize_official

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "node-laps.json").read_text())


def test_python_compiler_matches_typescript():
    for case in FIXTURE["cases"]:
        program = from_json((ROOT / "examples" / f"{case['agent']}.json").read_text())
        packed = program.packed()
        for key in ("slotCount", "io", "nodeInts", "nodeFloats", "linkSlots", "linkWeights"):
            assert packed[key] == case["program"][key], f"{case['agent']} {key}"


def test_python_laps_are_bit_identical_to_node():
    sim = Simulator()
    for case in FIXTURE["cases"]:
        program = from_json((ROOT / "examples" / f"{case['agent']}.json").read_text())
        result = fevo.evaluate(program, case["trackId"], sim=sim)
        got = [(l.seed, l.status, l.steps, l.gates_passed, l.hash) for l in result.laps]
        want = [(l["seed"], l["status"], l["steps"], l["gatesPassed"], l["hash"]) for l in case["laps"]]
        assert got == want, f"{case['agent']} on {case['trackId']}"
        assert result.median_steps == case["medianSteps"]


def test_traced_lap_matches_untraced():
    sim = Simulator()
    program = from_json((ROOT / "examples" / "example-mlp.json").read_text())
    sim.load_track("spielberg")
    sim.load_program(program)
    a = sim.run_lap(1)
    b = sim.run_lap(1, trace=True)
    assert a.hash == b.hash and len(b.trace["x"]) == b.steps + 1


def test_practice_settings_reset_for_official_laps():
    sim = Simulator()
    program = from_json((ROOT / "examples" / "example-genome.json").read_text())
    sim.configure(fevo.Practice(speed_limit=10.0))
    sim.load_track("spielberg")
    sim.load_program(program)
    slow = sim.run_lap(1)
    official = fevo.evaluate(program, "spielberg", sim=sim)
    assert slow.steps > official.laps[1].steps
    assert official.laps[1].hash == next(c for c in FIXTURE["cases"] if c["agent"] == "example-genome" and c["trackId"] == "spielberg")["laps"][1]["hash"]


def test_start_anywhere_counts_gates_behind_as_passed():
    sim = Simulator()
    sim.load_track("monza")
    sim.reset(point=2000)
    assert 0 < sim.gates_passed < len(sim.track.gates)


def test_neat_export_round_trips_to_the_same_program(tmp_path):
    """from_neat (neat-python's own network builder) and the upload file it exports compile identically."""
    import neat

    cfg_text = (ROOT / "tools" / "parity" / "make_neat_fixture.py").read_text().split('CONFIG = """')[1].split('"""')[0]
    path = tmp_path / "neat.ini"
    path.write_text(cfg_text)
    config = neat.Config(neat.DefaultGenome, neat.DefaultReproduction, neat.DefaultSpeciesSet, neat.DefaultStagnation, str(path))
    population = neat.Population(config)
    for genome in list(population.population.values())[:6]:
        for _ in range(25):
            genome.mutate(config.genome_config)
        program = fevo.from_neat(genome, config)
        assert program.packed() == from_json(json.dumps(fevo.neat_to_json(genome, config))).packed()
        # And the wasm computes what neat-python computes.
        net = neat.nn.FeedForwardNetwork.create(genome, config)
        sim = Simulator()
        sim.load_program(program)
        rng = __import__("random").Random(genome.key)
        for _ in range(20):
            x = [rng.uniform(-1, 1) for _ in range(15)]
            try:
                want = net.activate(x)
            except (OverflowError, ValueError, ZeroDivisionError):
                continue
            got = sim.evaluate_program(x)
            for g, w in zip(got, want):
                assert abs(g - w) <= 1e-9 * max(1, abs(g), abs(w)), (g, w)


def test_errors_match_website_wording():
    import pytest

    loop = {"nodes": [{"id": 0, "type": "output"}, {"id": 1, "type": "output"}, {"id": 17}, {"id": 23}],
            "connections": [{"in": 17, "out": 23, "weight": 1}, {"in": 23, "out": 17, "weight": 1}, {"in": 17, "out": 0, "weight": 1}]}  # fmt: skip
    with pytest.raises(fevo.AgentError, match="node 17, which feeds 23, which feeds 17"):
        from_json(json.dumps(loop))
    with pytest.raises(fevo.AgentError, match="takes 13 inputs, not 15"):
        from_json(json.dumps({"layers": [13, 2], "weights": [[0] * 26], "biases": [[0, 0]]}))


def test_fingerprint_matches_website():
    # The website showed fingerprint 6f77df for examples/example-genome.json.
    program = from_json((ROOT / "examples" / "example-genome.json").read_text())
    assert program.fingerprint().startswith("6f77df")


def test_step_fast_matches_step():
    a, b = Simulator(), Simulator()
    for s in (a, b):
        s.load_track("spielberg")
        s.reset(1)
    for i in range(600):
        steer, thr = 0.05 * ((i % 40) - 20) / 20, 1.0 if i % 100 < 70 else -0.5
        code, vals = a.step_fast(steer, thr)
        st = b.step(steer, thr)
        assert fevo.sim.STATUS[code] == st
        assert list(vals[:15]) == b.observation()
        assert int(vals[18]) == b.progress_index and int(vals[20]) == b.steps
        if st != "running":
            break
    assert a.state_hash() == b.state_hash()
