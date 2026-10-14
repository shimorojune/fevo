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

Added 2026-10-14: tyres lock up under braking and spin under power when asked for more than their grip; a sliding tyre gives 85% of peak grip and almost no cornering force (locked fronts go straight on, spinning rears step out). There's no ABS or traction control. Braking moves load onto the front axle (CG height 0.28 m), so the best brake bias depends on how hard the car is braking. The simulator reports lock-up and wheelspin per axle each step, and replays show them (tyre colour, smoke, skid marks, telemetry ticks).

Added 2026-10-14 (simulator 1.1.0, rules solo-2): power oversteer. In solo-1 the rears spin only while the drive force alone is more than their grip. Power mid-corner is just scaled back along the friction circle and never breaks the rear away. solo-2 adds a "combined-slip" rear model, tuned to behave like a real car: a slide at the limit is catchable with a lift and costs time, while holding big throttle mid-corner spins you.

- **Breakaway:** with the throttle open, the rears break away once drive plus cornering together (√(Fx² + Fy²)) ask for more than peak grip.
- **Sliding force:** a spinning rear tyre slides with Coulomb friction, 0.9 × peak grip (`rearSlideMu`). The force acts against the contact patch's sliding velocity: wheelspin forward, the rear axle's sideways velocity (vy − b·r) across. The cornering share therefore falls as wheelspin grows relative to the sideways slide. There's no fixed lateral share.
- **Wheelspin:** comes from the power balance on a quasi-static wheel, power = Fx·(vx + wheelspin). It has exactly one root, found by a fixed bisection every substep. So there's no wheel-speed state to integrate (an explicit wheel-spin update was unstable at 240 Hz) and nothing engine-dependent.
- **Re-grip:** the rears grip again once the demand drops below sliding grip (static vs kinetic friction), or the throttle closes.
- **Measured:** at 200 km/h a 4-step stab of full throttle breaks the rear away, half throttle keeps it sliding, and a lift catches it at about 6° body slip. Holding full throttle for half a second spins the car (over 45°).
- **Scripted test driver:** laps all three circuits on solo-2 within 2% of solo-1 (the same time, to 0.05%).

An earlier draft of solo-2 cut the rears to a fixed 25% cornering share the moment combined demand passed grip, and held them there until the demand fell below 0.88 × sliding grip. Any throttle at the cornering limit snapped the car round. The scripted driver crashed at Monza and Austin, and the 1:19.83 driver didn't get past gate 11.

The rules choose the model (`tyres` in `packages/rules`; no block means drive-only). `configure()` in TypeScript and Python sets it every time, because the wasm keeps it between laps. The slide state is mixed into the state hash only while a slide is active. Every solo-1 lap is bit-identical on 1.1.0: all 54 laps of the fevo-racer1 winners on the three circuits and the 9 parity fixture cases match the 1.0.0 hashes. solo-1 stays the website's ranked version; solo-2 ships in the SDK.

The 1:19.83 Spielberg driver (trained on solo-1) doesn't finish on solo-2 yet. Two seeds reach gate 100 of 108 before a power slide ends the lap, and one spins at gate 35. Its steering never had to catch the rear, so it gets retrained on solo-2.

## 5. Lap rules in the sim

Standing start on the start line. A lap ends as crashed when any corner of the car is outside the track edges (checked every physics substep), stopped after 120 steps below 1 m/s, timed out at 12,000 steps, or errored on a NaN/infinite output. Gates must be passed in order; crossing the start line after the last gate finishes the lap. Steer is −1 left to +1 right at the API; offset and heading error in the observation are positive to the right.

Added 2026-10-14 (simulator 1.2.0, rules solo-3): F1's track limit. Until now a lap ended as crashed as soon as any corner of the car's body rectangle (5.3 m by 1.9 m, checked every physics substep against the edges at the nearest centre-line point) crossed an edge line, so the whole car had to stay inside the lines. solo-3 is solo-2 with the rule F1 uses: the car is legal while any part of at least one tyre is on the track (the line counts as track), and the lap ends as crashed only once all four tyres are past it. Tyres sit at the axles (cgToFront ahead of the centre of mass, wheelbase − cgToFront behind it) with their outer edges at the car's full width; the part of the tyres nearest the track is always an outer edge, so tyre width doesn't enter the rule and no new car numbers were needed. Driving straight, the car's centre may now be 0.95 m past an edge instead of 0.95 m inside it: 1.9 m more usable width per side. There is no surface model beyond the edges (no grass or runoff), so a tyre over the line grips as it does on the track; that is unchanged. The rules choose the limit (`trackLimits` in `packages/rules`; none means all corners inside) and `configure()` in TypeScript and Python sets it every time. solo-1 and solo-2 are bit-identical on 1.2.0: 69 winner laps per rules version on the three circuits match 1.1.0, the original 54 still match 1.0.0, and the parity fixture is unchanged. Of the example agents only the low-wing MLP at Austin drives differently on solo-3: it crashed late in every lap on solo-2 and now finishes all three.
