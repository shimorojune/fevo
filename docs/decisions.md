# Decisions

Agreed with Rohit on 2026-10-13. Background: the feasibility write-up in the project library (`fevo-feasibility.md`).

## 1. Simulator core in AssemblyScript, compiled to one wasm

The design ranks a lap only if browser and server step counts match exactly. Host `Math.sin/cos/atan2/tanh` differ between V8, JavaScriptCore, SpiderMonkey and Python's libm, and a racing sim amplifies one-ULP differences. AssemblyScript compiles its own maths into the wasm, and wasm float semantics are deterministic, so the same binary gives bit-identical laps in browsers, the Node verifier and Python training (via wasmtime).

## 2. Track data: TUMFTM now, orthophoto-traced edges later

TUMFTM racetrack-database gives centreline plus left/right widths in metres (estimated ±0.5–1 m) for Spielberg, Monza and Austin. Each bake resamples the centreline to 1 m along a centripetal Catmull-Rom spline (linear resampling put kinks at every source point), then is validated against the official lap length and checked for folded edges. First bakes: Spielberg −0.05%, Monza −0.04%, Austin −0.08% from official length, no folds. Start/finish positions still need checking against imagery. Later revisions trace edges on open orthophotos (~±0.3–0.5 m). The sim is 2D; elevation is out of scope.

## 3. Real team liveries, centrally swappable

Real team and circuit names are trademarks; Rohit accepts the risk. All of them live in `packages/branding` with a generic counterpart, and `BRANDING_MODE` switches the whole platform. All cars are mechanically identical; liveries are cosmetic.

## 4. Physics: dynamic bicycle model with tyres and aero

Single-track model, simplified Pacejka lateral tyres (peak slip ~6.5°, ~84% grip retained well past the peak), a friction circle per axle that scales drive/brake and cornering forces together, downforce and drag ∝ v², power-limited rear drive with no traction control, kinematic blend below 3–6 m/s. Agent at 60 Hz, physics at 240 Hz.

The rear tyres get more grip and cornering stiffness than the fronts, as on a real F1 car. With equal tyres the car was neutral-steering and spun as soon as power went down mid-corner.

Calibrated on 2026-10-13 with `tools/calibrate`: a minimum-curvature racing line per circuit, a point-mass reference lap along it, and a fit of tyre grip, downforce, drag and brakes to 2025 pole times, restricted to a physically plausible car (top speed 340–360 km/h, at most about 5 g at 200 km/h and 6.5 g at 300 km/h, mechanical grip μ ≤ 2.0). Result: μ 2.0 front / 2.15 rear, downforce area 4.0 m², drag area 1.25 m², 60 kN brakes, 0.38 rad (22°) steering lock. Top speed 358 km/h; reference laps Spielberg 1:07.1, Monza 1:23.1, Austin 1:41.3, i.e. 5–10% slower than pole. Matching pole exactly needed an implausible car (10 g at 300 km/h or 400 km/h top speed), so the remaining gap is put down to track data, kerbs and the strict all-four-corners track limit. `check-grip` confirms the full vehicle model reaches about 95% of the reference's cornering grip at every speed (it understeers slightly at the limit).

## 5. Lap rules in the sim

Standing start on the start line. A lap ends as crashed when any corner of the car is outside the track edges (checked every physics substep), stopped after 120 steps below 1 m/s, timed out at 12,000 steps, or errored on a NaN/infinite output. Gates must be passed in order; crossing the start line after the last gate finishes the lap. Steer is −1 left to +1 right at the API; offset and heading error in the observation are positive to the right.
