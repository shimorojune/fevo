# Agent file format (rules solo-1)

One JSON file, up to 500 KB. Two shapes are accepted. Both compile to the same internal program and run inside the simulator's wasm, so a lap is bit-identical in every browser and on the server.

The network gets 15 inputs per step and returns 2 outputs.

| Input | Meaning | Range |
|---|---|---|
| 0–10 | Ray distances to the track edge, left (−90°) to right (+90°), ÷ 200 m | 0 to 1 |
| 11 | Forward speed ÷ 100 m/s | 0 to 1 |
| 12 | Gates passed ÷ total gates | 0 to 1 |
| 13 | Distance from the centre line ÷ half the track width, positive to the right | −1 to 1 |
| 14 | Angle between the car and the track direction ÷ π, positive when pointing right | −1 to 1 |

Outputs: `steer` (−1 full left, +1 full right) then `throttle` (+1 full power, negative brakes). Values outside −1..1 are clamped; NaN or infinity ends the lap with an error.

## NEAT genome

```json
{
  "inputKeys": [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -15],
  "outputKeys": [0, 1],
  "nodes": [
    { "id": 0, "type": "output", "bias": 0.1, "response": 1.0, "activation": "tanh", "aggregation": "sum" },
    { "id": 1, "type": "output", "bias": -0.2, "response": 1.0, "activation": "tanh", "aggregation": "sum" },
    { "id": 7, "type": "hidden", "bias": 0.0, "response": 1.0, "activation": "relu", "aggregation": "sum" }
  ],
  "connections": [
    { "in": -1, "out": 7, "weight": 0.8, "enabled": true },
    { "in": 7, "out": 0, "weight": -1.2, "enabled": true }
  ]
}
```

- Each node computes `activation(bias + response × aggregation(inputs × weights))`. The functions are neat-python 2.0's, exactly: for example `tanh` is `tanh(2.5·z)` and `sigmoid` is `1 / (1 + e^(−5·z))`. All 18 neat-python activations and 7 aggregations are supported.
- Evaluation follows neat-python 2.0's `FeedForwardNetwork`. Nodes that don't feed an output are ignored, disabled connections are ignored, and a required node with no inputs outputs `activation(bias)`.
- Inputs: use `inputKeys`, or list input nodes with `"type": "input"`. If neither is given, the inputs are neat-python's −1 … −15, with −1 as input 0. Outputs: use `outputKeys`, or the ascending ids of `"output"` nodes.
- `response` defaults to 1, `aggregation` to `sum`, `activation` to `tanh`, `enabled` to true.
- No loops: a node may not feed back into itself, directly or through others.

A genome exported from neat-python with every node's `bias`, `response`, `activation` and `aggregation` scores the same as neat-python computes it. `packages/sim/test` checks this against neat-python 2.0 on evolved genomes that use every function.

## MLP

```json
{
  "layers": [15, 32, 2],
  "activation": "tanh",
  "outputActivation": "tanh",
  "weights": [[ /* 32 × 15 */ ], [ /* 2 × 32 */ ]],
  "biases": [[ /* 32 */ ], [ /* 2 */ ]]
}
```

- Weights are row-major `[out][in]`, which is what PyTorch's `layer.weight.flatten()` gives.
- Activations use the textbook definitions: `tanh`, `sigmoid`, `relu`, `identity`. `outputActivation` defaults to `activation`.

## Car setup

Either format may carry a `"setup"` block. Anything left out uses the default; values outside the published ranges are rejected. The setup changes the car for all three official laps and is part of the fingerprint.

```json
"setup": { "wing": 0.15, "aeroBalance": 0.44, "antiRollBalance": -0.3, "brakeBias": 0.57 }
```

| Key | Range | Default | Effect |
|---|---|---|---|
| `wing` | 0–1 | 0.3 | Downforce area 3.4–5.4 m², drag area 1.15–1.50 m² (≈370 → 330 km/h top speed) |
| `aeroBalance` | 0.40–0.50 | 0.45 | Share of downforce on the front axle |
| `antiRollBalance` | −1–1 | 0 | Stiffer front bar (+): sharper front response, less front grip at the limit; stiffer rear (−) the opposite |
| `brakeBias` | 0.52–0.64 | 0.58 | Share of brake force on the front axle |

Every knob is linear (`param = base + perUnit × (value − default)`); the exact numbers are in `packages/rules/src/solo1.ts` and on the rules page.

## Examples

`examples/example-genome.json` and `examples/example-mlp.json` are tiny hand-structured agents tuned to finish every solo-1 circuit. They show the formats; they are not fast.
