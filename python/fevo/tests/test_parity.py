import json
from pathlib import Path

import fevo
from fevo.program import from_json
from fevo.sim import Simulator, summarize_official

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "node-laps.json").read_text())


def _case(agent: str, track: str, rules: str) -> dict:
    return next(c for c in FIXTURE["cases"] if (c["agent"], c["trackId"], c["rules"]) == (agent, track, rules))


def test_python_compiler_matches_typescript():
    for case in FIXTURE["cases"]:
        program = from_json(case["text"])
        assert program.fingerprint() == case["fingerprint"], case["agent"]
        packed = program.packed()
        for key in ("slotCount", "io", "nodeInts", "nodeFloats", "linkSlots", "linkWeights"):
            assert packed[key] == case["program"][key], f"{case['agent']} {key}"


def test_python_laps_are_bit_identical_to_node():
    sims = {rules: Simulator(rules) for rules in fevo.data.manifest()["rules"]}
    assert {c["rules"] for c in FIXTURE["cases"]} == set(sims)
    for case in FIXTURE["cases"]:
        program = from_json(case["text"])
        result = fevo.evaluate(program, case["trackId"], sim=sims[case["rules"]])
        got = [(l.seed, l.status, l.steps, l.gates_passed, l.hash) for l in result.laps]
        want = [(l["seed"], l["status"], l["steps"], l["gatesPassed"], l["hash"]) for l in case["laps"]]
        assert got == want, f"{case['agent']} on {case['trackId']} ({case['rules']})"
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
    assert official.laps[1].hash == _case("example-genome", "spielberg", "solo-1")["laps"][1]["hash"]


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


def test_setup_validation_and_default():
    import pytest

    text = (ROOT / "examples" / "example-mlp.json").read_text()
    assert from_json(text).setup == [0.3, 0.45, 0.0, 0.58]
    with pytest.raises(fevo.AgentError, match="between 0 and 1"):
        from_json(json.dumps({**json.loads(text), "setup": {"wing": 1.5}}))
    with pytest.raises(fevo.AgentError, match='Unknown setup "gears"'):
        from_json(json.dumps({**json.loads(text), "setup": {"gears": 8}}))


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


def test_solo2_ships_with_power_oversteer_and_solo1_without():
    assert fevo.data.manifest()["simVersion"] == "1.5.0"
    assert fevo.load_rules("solo-1").rear_slide == (0, 1.0)
    assert fevo.load_rules("solo-2").rear_slide == (1, 0.9)
    one, two = fevo.load_rules("solo-1").raw, fevo.load_rules("solo-2").raw
    assert "tyres" not in one
    assert {k: v for k, v in two.items() if k not in ("id", "simVersion", "tyres")} == {
        k: v for k, v in one.items() if k not in ("id", "simVersion")
    }


def test_one_simulator_switching_rules_matches_fresh_ones():
    """The rear slide model lives in the wasm, so configure() must set it every time, solo-1 included."""
    program = from_json((ROOT / "examples" / "example-mlp.json").read_text())
    sim = Simulator("solo-2")
    sim.load_track("spielberg")
    sim.load_program(program)
    sim.run_lap(1)
    sim.rules = fevo.load_rules("solo-1")
    sim.configure()
    assert sim.run_lap(1).hash == _case("example-mlp", "spielberg", "solo-1")["laps"][1]["hash"]


def test_replay_can_put_one_driver_on_two_rules_versions(tmp_path):
    program = from_json((ROOT / "examples" / "example-mlp.json").read_text())
    out = fevo.write_replay([("mlp solo-1", program, "solo-1"), ("mlp solo-2", program, "solo-2")], tmp_path / "r.html", ["spielberg"])
    html = out.read_text()
    assert '"rules":"solo-1","circuitId":"spielberg"' in html and '"rules":"solo-2","circuitId":"spielberg"' in html


def test_solo3_ships_with_the_one_tyre_limit_and_earlier_rules_without():
    assert [fevo.load_rules(r).track_limits for r in ("solo-1", "solo-2", "solo-3")] == [0, 0, 1]
    two, three = fevo.load_rules("solo-2").raw, fevo.load_rules("solo-3").raw
    assert {k: v for k, v in three.items() if k not in ("id", "simVersion", "trackLimits")} == {
        k: v for k, v in two.items() if k not in ("id", "simVersion")
    }


def test_solo4_widened_networks_lap_exactly_like_the_originals_on_solo3():
    """Zero weights on the 18 extra inputs: the 33-input network is the 15-input one, bit for bit."""
    four = [c for c in FIXTURE["cases"] if c["rules"] == "solo-4"]
    assert four, "the fixture has solo-4 cases"
    for c in four:
        assert c["laps"] == _case(c["agent"], c["trackId"], "solo-3")["laps"], f"{c['agent']} on {c['trackId']}"
    assert len(fevo.load_rules("solo-4").observation) == 33 and fevo.load_rules("solo-4").observation_set == 1
