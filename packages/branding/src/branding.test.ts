import assert from "node:assert/strict";
import { test } from "node:test";
import { CIRCUITS, TEAMS, circuitBrand, teamBrand } from "./index.ts";

test("ids are unique", () => {
  assert.equal(new Set(TEAMS.map((t) => t.id)).size, TEAMS.length);
  assert.equal(new Set(CIRCUITS.map((c) => c.id)).size, CIRCUITS.length);
});

test("generic branding never leaks a real name", () => {
  for (const t of TEAMS) {
    assert.notEqual(t.generic.name, t.real.name);
    assert.notEqual(t.generic.shortName, t.real.shortName);
  }
  for (const c of CIRCUITS) assert.ok(!c.generic.name.includes(c.real.name));
});

test("colours are hex", () => {
  for (const t of TEAMS) for (const v of Object.values(t.real.colors)) assert.match(v, /^#[0-9A-F]{6}$/);
});

test("lookups switch with mode", () => {
  assert.equal(teamBrand("ferrari", "real").name, "Scuderia Ferrari");
  assert.equal(teamBrand("ferrari", "generic").name, "Team Scarlet");
  assert.equal(circuitBrand("spielberg", "generic").name, "Spielberg");
  assert.throws(() => teamBrand("nope"));
});
