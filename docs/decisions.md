# Decisions

Agreed with Rohit on 2026-10-13. Background: the feasibility write-up in the project library (`fevo-feasibility.md`).

## 1. Simulator core in AssemblyScript, compiled to one wasm

The design ranks a lap only if browser and server step counts match exactly. Host `Math.sin/cos/atan2/tanh` differ between V8, JavaScriptCore, SpiderMonkey and Python's libm, and a racing sim amplifies one-ULP differences. AssemblyScript compiles its own maths into the wasm, and wasm float semantics are deterministic, so the same binary gives bit-identical laps in browsers, the Node verifier and Python training (via wasmtime).

## 2. Track data: TUMFTM now, orthophoto-traced edges later

TUMFTM racetrack-database gives centreline plus left/right widths in metres (estimated ±0.5–1 m) for Spielberg, Monza and Austin. Each bake resamples the centreline to 1 m along a centripetal Catmull-Rom spline (linear resampling put kinks at every source point), then is validated against the official lap length and checked for folded edges. First bakes: Spielberg −0.05%, Monza −0.04%, Austin −0.08% from official length, no folds. Start/finish positions still need checking against imagery. Later revisions trace edges on open orthophotos (~±0.3–0.5 m). The sim is 2D; elevation is out of scope.

## 3. Real team liveries, centrally swappable

Real team and circuit names are trademarks; Rohit accepts the risk. All of them live in `packages/branding` with a generic counterpart, and `BRANDING_MODE` switches the whole platform. All cars are mechanically identical; liveries are cosmetic.

## 4. Physics: dynamic bicycle model with tyres and aero

Single-track model, simplified Pacejka lateral tyres, friction ellipse per axle, downforce and drag ∝ v², power-limited rear drive, kinematic blend below 3–6 m/s. Agent at 60 Hz, physics at 240 Hz. First-pass solo-1 numbers (checked with a JS mirror of the model): 0–100 km/h 2.95 s, top speed 345 km/h, 300–0 km/h in 106 m, ~2.9 g steady at 200 km/h. Calibrated against real lap times before solo-1 is frozen.
