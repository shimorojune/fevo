"""
Build a parity fixture from real neat-python genomes.

Evolves random feed-forward genomes with every activation and aggregation
neat-python offers, exports each to fevo's genome JSON, and records
neat-python's own outputs on random inputs. packages/sim's tests check the
wasm reproduces them.

    python tools/parity/make_neat_fixture.py packages/sim/test/fixtures/neat-python.json
"""
import json
import os
import random
import sys
import tempfile

import neat

CONFIG = """
[NEAT]
fitness_criterion     = max
fitness_threshold     = 1e9
pop_size              = 12
reset_on_extinction   = False
no_fitness_termination = True

[DefaultGenome]
activation_default      = random
activation_mutate_rate  = 0.5
activation_options      = sigmoid tanh sin gauss relu elu lelu selu softplus identity clamped inv log exp abs hat square cube
aggregation_default     = random
aggregation_mutate_rate = 0.5
aggregation_options     = sum product max min maxabs median mean
bias_init_mean          = 0.0
bias_init_stdev         = 1.0
bias_max_value          = 30.0
bias_min_value          = -30.0
bias_mutate_power       = 0.5
bias_mutate_rate        = 0.7
bias_replace_rate       = 0.1
compatibility_disjoint_coefficient = 1.0
compatibility_weight_coefficient   = 0.5
conn_add_prob           = 0.9
conn_delete_prob        = 0.2
enabled_default         = True
enabled_mutate_rate     = 0.1
feed_forward            = True
initial_connection      = partial_direct 0.5
node_add_prob           = 0.6
node_delete_prob        = 0.1
num_hidden              = 0
num_inputs              = 15
num_outputs             = 2
response_init_mean      = 1.0
response_init_stdev     = 0.3
response_max_value      = 30.0
response_min_value      = -30.0
response_mutate_power   = 0.3
response_mutate_rate    = 0.5
response_replace_rate   = 0.1
weight_init_mean        = 0.0
weight_init_stdev       = 1.0
weight_max_value        = 30
weight_min_value        = -30
weight_mutate_power     = 0.5
weight_mutate_rate      = 0.8
weight_replace_rate     = 0.1

[DefaultSpeciesSet]
compatibility_threshold = 3.0

[DefaultStagnation]
species_fitness_func = max
max_stagnation       = 20
species_elitism      = 2

[DefaultReproduction]
elitism            = 2
survival_threshold = 0.2
"""


def export(genome, config):
    """fevo genome JSON, keeping file order = neat-python's connection order."""
    out_keys = set(config.genome_config.output_keys)
    return {
        "inputKeys": list(config.genome_config.input_keys),
        "outputKeys": list(config.genome_config.output_keys),
        "nodes": [
            {
                "id": k,
                "type": "output" if k in out_keys else "hidden",
                "bias": n.bias,
                "response": n.response,
                "activation": n.activation,
                "aggregation": n.aggregation,
            }
            for k, n in genome.nodes.items()
        ],
        "connections": [
            {"in": a, "out": b, "weight": c.weight, "enabled": c.enabled}
            for (a, b), c in genome.connections.items()
        ],
    }


def main(out_path):
    random.seed(20261013)
    with tempfile.NamedTemporaryFile("w", suffix=".ini", delete=False) as f:
        f.write(CONFIG)
        cfg_path = f.name
    config = neat.Config(
        neat.DefaultGenome, neat.DefaultReproduction, neat.DefaultSpeciesSet, neat.DefaultStagnation, cfg_path
    )
    os.unlink(cfg_path)

    # Population sets up neat-python 2.0's innovation tracker for us.
    population = neat.Population(config)
    genomes = list(population.population.values())[:8]
    for g, genome in enumerate(genomes):
        for _ in range(10 + 5 * g):
            genome.mutate(config.genome_config)

    cases = []
    for genome in genomes:
        net = neat.nn.FeedForwardNetwork.create(genome, config)
        samples = []
        for _ in range(40):
            x = [random.uniform(-1.2, 1.2) for _ in range(15)]
            try:
                y = net.activate(x)
            except (OverflowError, ValueError, ZeroDivisionError):
                continue
            samples.append({"inputs": x, "outputs": y})
        cases.append({"genome": export(genome, config), "samples": samples})

    meta = {"neat_python": getattr(neat, "__version__", "unknown"), "python": sys.version.split()[0]}
    with open(out_path, "w") as f:
        json.dump({"meta": meta, "cases": cases}, f, indent=1)
    hidden = [sum(1 for k in c["genome"]["nodes"] if k["type"] == "hidden") for c in cases]
    print(f"wrote {out_path}: {len(cases)} genomes, hidden nodes {hidden}")


if __name__ == "__main__":
    main(sys.argv[1])
