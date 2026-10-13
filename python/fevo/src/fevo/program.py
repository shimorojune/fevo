"""Agent programs: the compiled network the simulator evaluates.

A program is format-independent. You get one from a neat-python genome
(`from_neat`), from an uploaded-format JSON file (`from_json`, a port of
@fevo/agent-format that tests check against the TypeScript compiler), or
build one yourself.

Codes MUST match packages/agent-format/src/functions.ts.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
import json
import math
from dataclasses import dataclass, field
from typing import Any, Iterable

GENOME_ACTIVATIONS = {
    "sigmoid": 0, "tanh": 1, "sin": 2, "gauss": 3, "relu": 4, "elu": 5, "lelu": 6, "selu": 7, "softplus": 8,
    "identity": 9, "clamped": 10, "inv": 11, "log": 12, "exp": 13, "abs": 14, "hat": 15, "square": 16, "cube": 17,
}  # fmt: skip
MLP_ACTIVATIONS = {"tanh": 20, "sigmoid": 21, "relu": 22, "identity": 23}
AGGREGATIONS = {"sum": 0, "product": 1, "max": 2, "min": 3, "maxabs": 4, "median": 5, "mean": 6}

MAX_FILE_BYTES = 500 * 1024
MAX_NODES = 2000
MAX_CONNECTIONS = 20000


@dataclass
class Node:
    slot: int
    activation: int
    aggregation: int
    bias: float
    response: float
    links: list[tuple[int, float]] = field(default_factory=list)


@dataclass
class Program:
    kind: str
    slot_count: int
    input_slots: list[int]
    output_slots: list[int]
    nodes: list[Node]
    #: Car setup, complete and in the rules' knob order (None: default car, no setup block allowed).
    setup: list[float] | None = None

    @property
    def parameters(self) -> int:
        return sum(len(n.links) + 1 for n in self.nodes)

    def packed(self) -> dict[str, list]:
        node_ints: list[int] = []
        node_floats: list[float] = []
        link_slots: list[int] = []
        link_weights: list[float] = []
        for n in self.nodes:
            node_ints += [n.slot, n.activation, n.aggregation, len(link_slots), len(n.links)]
            node_floats += [n.bias, n.response]
            for s, w in n.links:
                link_slots.append(s)
                link_weights.append(w)
        return {
            "slotCount": self.slot_count,
            "io": self.input_slots + self.output_slots,
            "nodeInts": node_ints,
            "nodeFloats": node_floats,
            "linkSlots": link_slots,
            "linkWeights": link_weights,
        }

    def fingerprint(self) -> str:
        """Same SHA-256 the website shows (it displays the first 6 characters)."""
        def node(n: Node) -> str:
            links = ",".join(f'{{"slot":{s},"weight":{_js_num(w)}}}' for s, w in n.links)
            return (f'{{"slot":{n.slot},"activation":{n.activation},"aggregation":{n.aggregation},'
                    f'"bias":{_js_num(n.bias)},"response":{_js_num(n.response)},"links":[{links}]}}')  # fmt: skip
        ints = lambda xs: ",".join(map(str, xs))  # noqa: E731
        setup = f',[{",".join(_js_num(v) for v in self.setup)}]' if self.setup is not None else ""
        text = f'["{self.kind}",{self.slot_count},[{ints(self.input_slots)}],[{ints(self.output_slots)}],[{",".join(map(node, self.nodes))}]{setup}]'
        return hashlib.sha256(text.encode()).hexdigest()


def _js_num(x: float) -> str:
    """Format a number the way JavaScript's JSON.stringify does."""
    if x == 0:
        return "0"
    if x == int(x) and abs(x) < 1e21:
        return str(int(x))
    r = repr(float(x))
    if "e" in r:
        mant, exp = r.split("e")
        e = int(exp)
        if -7 < e < 21:
            # Shortest round-trip digits, written out without an exponent.
            return format(Decimal(r), "f")
        return f"{mant}e{'+' if e > 0 else '-'}{abs(e)}"
    return r


class AgentError(ValueError):
    """An agent file that the website would reject, with the same message."""

    def __init__(self, code: str, message: str, hint: str | None = None) -> None:
        super().__init__(message if hint is None else f"{message} {hint}")
        self.code = code
        self.message = message
        self.hint = hint


# --------------------------------------------------------------------------- neat-python


def from_neat(genome: Any, config: Any) -> Program:
    """Compile a neat-python genome exactly as the website will compile its upload file.

    Going through the upload format means training evaluates the identical
    program the website and server will run. Its semantics match neat-python
    2.0's FeedForwardNetwork; the test suite checks that against neat-python.
    """
    return from_json(json.dumps(neat_to_json(genome, config)), len(config.genome_config.input_keys), len(config.genome_config.output_keys))


def neat_to_json(genome: Any, config: Any, setup: dict[str, float] | None = None) -> dict[str, Any]:
    """The upload file for a neat-python genome: every field the website needs, in neat-python's order."""
    gc = config.genome_config
    outputs = set(gc.output_keys)
    out = {
        "inputKeys": list(gc.input_keys),
        "outputKeys": list(gc.output_keys),
        "nodes": [
            {"id": k, "type": "output" if k in outputs else "hidden", "bias": n.bias, "response": n.response,
             "activation": n.activation, "aggregation": n.aggregation}
            for k, n in genome.nodes.items()
        ],
        "connections": [
            {"in": a, "out": b, "weight": c.weight, "enabled": c.enabled} for (a, b), c in genome.connections.items()
        ],
    }  # fmt: skip
    if setup:
        out["setup"] = dict(setup)
    return out


# --------------------------------------------------------------------------- uploaded JSON


_RULES_SETUP = object()


def from_json(text: str, inputs: int = 15, outputs: int = 2, setup_knobs: Any = _RULES_SETUP) -> Program:
    """Validate and compile an uploaded-format JSON agent, like the website does.

    The setup block is checked against the current rules' knobs (pass setup_knobs=None for
    a rules version without setups)."""
    if setup_knobs is _RULES_SETUP:
        from .data import load_rules

        setup_knobs = load_rules().setup
    if len(text.encode()) > MAX_FILE_BYTES:
        raise AgentError("too_large", f"The file is over {MAX_FILE_BYTES // 1024} KB.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise AgentError("invalid_json", f"This file isn't valid JSON. Line {e.lineno}, column {e.colno}: {e.msg}.") from None
    if isinstance(data, dict) and isinstance(data.get("nodes"), list) and isinstance(data.get("connections"), list):
        return _with_setup(_compile_genome(data, inputs, outputs), data, setup_knobs)
    if isinstance(data, dict) and isinstance(data.get("layers"), list):
        return _with_setup(_compile_mlp(data, inputs, outputs), data, setup_knobs)
    raise AgentError("unknown_format", "This doesn't look like a NEAT genome or an MLP.")


def _with_setup(program: Program, data: dict[str, Any], knobs: list[dict[str, Any]] | None) -> Program:
    given = data.get("setup")
    if given is not None:
        if not knobs:
            raise AgentError("bad_field", 'This rules version has no car setup, so remove the "setup" block.')
        if not isinstance(given, dict):
            raise AgentError("bad_field", '"setup" must be an object.')
        for key, value in given.items():
            k = next((x for x in knobs if x["id"] == key), None)
            if k is None:
                raise AgentError("bad_field", f'Unknown setup "{key}". Known: {", ".join(x["id"] for x in knobs)}.')
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise AgentError("bad_field", f"setup.{key} must be a number.")
            if not k["min"] <= value <= k["max"]:
                raise AgentError("bad_field", f"setup.{key} is {value}; it must be between {k['min']} and {k['max']}.")
    if knobs:
        program.setup = [float(given[k["id"]]) if given and k["id"] in given else float(k["default"]) for k in knobs]
    return program


def _num(v: Any, field: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise AgentError("bad_field", f"{field} is {json.dumps(v)}, not a number.", "Look for missing biases or weights saved as null or NaN.")
    return float(v)


def _int(v: Any, field: str) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
        raise AgentError("bad_field", f"{field} must be an integer, not {json.dumps(v)}.")
    return int(v)


def _compile_genome(data: dict[str, Any], n_in: int, n_out: int) -> Program:
    raw_nodes, raw_conns = data["nodes"], data["connections"]
    if len(raw_nodes) > MAX_NODES or len(raw_conns) > MAX_CONNECTIONS:
        raise AgentError("too_big", "The genome is larger than the limits allow.")
    nodes: dict[int, dict[str, Any]] = {}
    for i, raw in enumerate(raw_nodes):
        nid = _int(raw.get("id"), f"nodes[{i}].id")
        if nid in nodes:
            raise AgentError("duplicate_id", f"Node {nid} appears twice.")
        typ = raw.get("type", "hidden")
        if typ not in ("input", "hidden", "output"):
            raise AgentError("bad_field", f'nodes[{i}].type must be "input", "hidden" or "output".')
        act = str(raw.get("activation", "tanh"))
        agg = str(raw.get("aggregation", "sum"))
        if typ != "input" and act not in GENOME_ACTIVATIONS:
            raise AgentError("unknown_activation", f'Node {nid} uses activation "{act}", which isn\'t supported.')
        if typ != "input" and agg not in AGGREGATIONS:
            raise AgentError("unknown_aggregation", f'Node {nid} uses aggregation "{agg}", which isn\'t supported.')
        nodes[nid] = {
            "type": typ,
            "bias": 0.0 if typ == "input" else _num(raw.get("bias", 0), f"nodes[{i}].bias (node {nid})"),
            "response": 1.0 if typ == "input" else _num(raw.get("response", 1), f"nodes[{i}].response (node {nid})"),
            "act": GENOME_ACTIVATIONS.get(act, 0),
            "agg": AGGREGATIONS.get(agg, 0),
        }
    declared = [k for k, n in nodes.items() if n["type"] == "input"]
    if isinstance(data.get("inputKeys"), list):
        input_keys = [_int(v, f"inputKeys[{i}]") for i, v in enumerate(data["inputKeys"])]
    elif declared:
        input_keys = sorted(declared, reverse=all(k < 0 for k in declared))
    else:
        input_keys = [-(i + 1) for i in range(n_in)]
    if isinstance(data.get("outputKeys"), list):
        output_keys = [_int(v, f"outputKeys[{i}]") for i, v in enumerate(data["outputKeys"])]
    else:
        output_keys = sorted(k for k, n in nodes.items() if n["type"] == "output")
    if len(input_keys) != n_in:
        raise AgentError("wrong_inputs", f"The network takes {len(input_keys)} inputs, not {n_in}.")
    if len(output_keys) != n_out:
        raise AgentError("wrong_outputs", f"The network has {len(output_keys)} outputs, not {n_out}.")
    input_set = set(input_keys)
    conns: list[tuple[int, int, float]] = []
    for i, raw in enumerate(raw_conns):
        a, b = _int(raw.get("in"), f"connections[{i}].in"), _int(raw.get("out"), f"connections[{i}].out")
        w = _num(raw.get("weight"), f"connections[{i}].weight ({a} → {b})")
        if raw.get("enabled") is False:
            continue
        if a not in input_set and a not in nodes:
            raise AgentError("bad_reference", f"Connection {a} → {b} starts at a node that doesn't exist.")
        if b not in nodes or b in input_set:
            raise AgentError("bad_reference", f"Connection {a} → {b} has a bad target.")
        conns.append((a, b, w))
    loop = _find_loop([(a, b) for a, b, _ in conns])
    if loop:
        raise AgentError("loop", "Your network has a loop: node " + ", which feeds ".join(map(str, loop)) + ".")

    layers, required = _feed_forward_layers(input_keys, output_keys, [(a, b) for a, b, _ in conns])
    req_inputs = required | input_set
    slot = {k: i for i, k in enumerate(input_keys)}
    nxt = len(slot)
    for k in output_keys:
        slot[k] = nxt
        nxt += 1
    for layer in layers:
        for k in layer:
            if k not in slot:
                slot[k] = nxt
                nxt += 1
    prog_nodes = []
    for layer in layers:
        for k in layer:
            n = nodes[k]
            links = [(slot[a], w) for a, b, w in conns if b == k and a in req_inputs]
            prog_nodes.append(Node(slot[k], n["act"], n["agg"], n["bias"], n["response"], links))
    return Program("neat-genome", nxt, [slot[k] for k in input_keys], [slot[k] for k in output_keys], prog_nodes)


def _find_loop(conns: list[tuple[int, int]]) -> list[int] | None:
    out: dict[int, list[int]] = {}
    for a, b in conns:
        out.setdefault(a, []).append(b)
    state: dict[int, int] = {}
    stack: list[int] = []

    def visit(n: int) -> list[int] | None:
        state[n] = 1
        stack.append(n)
        for m in out.get(n, []):
            if state.get(m) == 1:
                return stack[stack.index(m) :] + [m]
            if m not in state:
                found = visit(m)
                if found:
                    return found
        stack.pop()
        state[n] = 2
        return None

    for n in sorted(out):
        if n not in state:
            found = visit(n)
            if found:
                return found
    return None


def _feed_forward_layers(inputs: list[int], outputs: list[int], conns: list[tuple[int, int]]) -> tuple[list[list[int]], set[int]]:
    """Port of neat.graphs.required_for_output and feed_forward_layers (neat-python 2.0)."""
    input_set = set(inputs)
    required = set(outputs)
    s = set(outputs)
    while True:
        t = {a for a, b in conns if b in s and a not in s}
        if not t:
            break
        layer_nodes = {x for x in t if x not in input_set}
        if not layer_nodes:
            break
        required |= layer_nodes
        s |= t
    with_inputs = {b for _, b in conns}
    bias_neurons = sorted(required - with_inputs)
    layers: list[list[int]] = []
    ready = set(inputs) | set(bias_neurons)
    if bias_neurons:
        layers.append(bias_neurons)
    while True:
        cands = {b for a, b in conns if a in ready and b not in ready}
        layer = sorted(n for n in cands if n in required and all(a in ready for a, b in conns if b == n and a in required))
        if not layer:
            break
        layers.append(layer)
        ready |= set(layer)
    return layers, required


def _compile_mlp(data: dict[str, Any], n_in: int, n_out: int) -> Program:
    layers = [_int(v, f"layers[{i}]") for i, v in enumerate(data["layers"])]
    if len(layers) < 2:
        raise AgentError("mlp_shape", "layers must list at least an input and an output size.")
    if layers[0] != n_in:
        raise AgentError("wrong_inputs", f"The network takes {layers[0]} inputs, not {n_in}.", "Check the size of your first layer.")
    if layers[-1] != n_out:
        raise AgentError("wrong_outputs", f"The network has {layers[-1]} outputs, not {n_out}.", "Outputs are steer then throttle.")
    def act(name: Any) -> int:
        key = str(name if name is not None else "tanh")
        if key not in MLP_ACTIVATIONS:
            raise AgentError("unknown_activation", f'activation "{key}" isn\'t supported.')
        return MLP_ACTIVATIONS[key]
    hidden = act(data.get("activation"))
    output = act(data.get("outputActivation", data.get("activation")))
    weights, biases = data.get("weights"), data.get("biases")
    if not isinstance(weights, list) or not isinstance(biases, list) or len(weights) != len(layers) - 1 or len(biases) != len(layers) - 1:
        raise AgentError("mlp_shape", f"weights and biases need {len(layers) - 1} entries each.")
    nodes: list[Node] = []
    prev_start, slot = 0, n_in
    for l in range(1, len(layers)):
        ni, no = layers[l - 1], layers[l]
        w, b = weights[l - 1], biases[l - 1]
        if len(w) != ni * no or len(b) != no:
            raise AgentError("mlp_shape", f"layer {l} has the wrong number of weights or biases.")
        start = slot
        for j in range(no):
            links = [(i if l == 1 else prev_start + i, _num(w[j * ni + i], f"weights[{l - 1}][{j * ni + i}]")) for i in range(ni)]
            nodes.append(Node(slot, output if l == len(layers) - 1 else hidden, 0, _num(b[j], f"biases[{l - 1}][{j}]"), 1.0, links))
            slot += 1
        prev_start = start
    return Program("mlp", slot, list(range(n_in)), [prev_start + i for i in range(n_out)], nodes)


def iter_programs(paths: Iterable[str]) -> Iterable[tuple[str, Program]]:
    for p in paths:
        with open(p, encoding="utf-8") as f:
            yield p, from_json(f.read())
