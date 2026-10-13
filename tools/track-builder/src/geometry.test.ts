import assert from "node:assert/strict";
import { test } from "node:test";
import { bakeTrack } from "./bake.ts";
import { foldedSamples, loopLength, parseTumftmCsv, resampleClosed, signedArea } from "./geometry.ts";

/** Counter-clockwise circle as a TUMFTM CSV. */
function circleCsv(radius: number, points: number, width: number): string {
  const lines = ["# x_m,y_m,w_tr_right_m,w_tr_left_m"];
  for (let i = 0; i < points; i++) {
    const a = (2 * Math.PI * i) / points;
    lines.push(`${radius * Math.cos(a)},${radius * Math.sin(a)},${width},${width}`);
  }
  return lines.join("\n");
}

const source = { kind: "tumftm" as const, file: "circle.csv", url: "test", license: "test" };

test("parses TUMFTM CSV and skips comments", () => {
  const s = parseTumftmCsv(circleCsv(100, 72, 6));
  assert.equal(s.length, 72);
  assert.deepEqual(s[0], { x: 100, y: 0, wRight: 6, wLeft: 6 });
});

test("rejects malformed rows", () => {
  assert.throws(() => parseTumftmCsv("# h\n1,2,3\n4,5,6,7\n8,9,1,1"), /line 2/);
  assert.throws(() => parseTumftmCsv("1,2,0,1\n2,3,1,1\n4,5,1,1"), /non-positive width/);
});

test("drops a duplicated closing point", () => {
  const s = parseTumftmCsv("0,0,1,1\n10,0,1,1\n10,10,1,1\n0,0,1,1");
  assert.equal(s.length, 3);
});

test("spline resampling recovers a true circle and keeps the start point", () => {
  const raw = parseTumftmCsv(circleCsv(100, 72, 6));
  const { samples, spacingM } = resampleClosed(raw, 1);
  const circumference = 2 * Math.PI * 100;
  assert.equal(samples.length, Math.round(circumference));
  const rel = Math.abs(loopLength(samples) - circumference) / circumference;
  assert.ok(rel < 1e-5, `relative length error ${rel}`);
  for (const p of samples) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) < 1e-3, "stays on the circle");
  assert.ok(Math.abs(spacingM - 1) < 0.01);
  assert.deepEqual(samples[0], raw[0]);
});

test("detects direction and folded edges", () => {
  const ok = parseTumftmCsv(circleCsv(100, 72, 6));
  assert.ok(signedArea(ok) > 0);
  assert.equal(foldedSamples(resampleClosed(ok, 1).samples).length, 0);
  const tight = resampleClosed(parseTumftmCsv(circleCsv(5, 72, 6)), 0.5).samples;
  assert.equal(foldedSamples(tight).length, tight.length);
});

test("bake validates length and hashes deterministically", () => {
  const raw = parseTumftmCsv(circleCsv(100, 360, 6));
  const opts = {
    circuitId: "circle",
    revision: 1,
    source,
    officialLengthM: 2 * Math.PI * 100,
    startIndex: 0,
    spacingM: 1,
    gateSpacingM: 40,
    lengthTolerance: 0.001,
  };
  const a = bakeTrack(raw, opts);
  const b = bakeTrack(raw, opts);
  assert.deepEqual(a.report.errors, []);
  assert.equal(a.file.sha256, b.file.sha256);
  assert.equal(a.file.gates.length, 16);
  assert.equal(a.file.gates[0], 0);
  assert.equal(a.file.centerline.length, 2 * a.file.widthLeft.length);

  const wrong = bakeTrack(raw, { ...opts, officialLengthM: 700 });
  assert.match(wrong.report.errors[0]!, /from official/);
});

test("startIndex rotates the loop", () => {
  const raw = parseTumftmCsv(circleCsv(100, 360, 6));
  const { file } = bakeTrack(raw, {
    circuitId: "circle",
    revision: 1,
    source,
    officialLengthM: 628.3,
    startIndex: 90,
    spacingM: 1,
    gateSpacingM: 40,
    lengthTolerance: 0.01,
  });
  assert.ok(Math.abs(file.centerline[0]!) < 1e-3);
  assert.ok(Math.abs(file.centerline[1]! - 100) < 1e-3);
});
