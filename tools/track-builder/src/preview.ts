/**
 * Render every baked track to one HTML page of SVGs for eyeballing geometry:
 *   node src/preview.ts   ->  out/preview.html
 * Each circuit shows the full layout plus a zoom on its tightest corner with
 * a solo-1 car drawn at true size.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CIRCUITS, TEAMS, circuitBrand } from "@fevo/branding";
import { SOLO_1_CAR } from "@fevo/rules";
import type { TrackFile } from "@fevo/tracks";
import { smoothedCurvature, type Sample } from "./geometry.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "..", "packages", "tracks", "data");
const outDir = join(here, "..", "out");

type Pt = [number, number];

interface Geometry {
  center: Pt[];
  left: Pt[];
  right: Pt[];
}

function geometry(t: TrackFile): Geometry {
  const n = t.widthLeft.length;
  const center: Pt[] = [];
  for (let i = 0; i < n; i++) center.push([t.centerline[2 * i]!, t.centerline[2 * i + 1]!]);
  const left: Pt[] = [];
  const right: Pt[] = [];
  center.forEach((c, i) => {
    const p = center[(i - 1 + n) % n]!;
    const q = center[(i + 1) % n]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const nx = -(q[1] - p[1]) / len;
    const ny = (q[0] - p[0]) / len;
    left.push([c[0] + nx * t.widthLeft[i]!, c[1] + ny * t.widthLeft[i]!]);
    right.push([c[0] - nx * t.widthRight[i]!, c[1] - ny * t.widthRight[i]!]);
  });
  return { center, left, right };
}

/** SVG y runs down; track y runs up. */
const path = (pts: Pt[], close: boolean) =>
  pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)} ${(-p[1]).toFixed(2)}`).join("") + (close ? "Z" : "");

function trackLayers(g: Geometry, t: TrackFile, scale: number): string {
  const n = g.center.length;
  const gate = (i: number, cls: string) => {
    const a = g.left[i]!;
    const b = g.right[i]!;
    return `<line class="${cls}" x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke-width="${(cls === "start" ? 3 : 1) * scale}"/>`;
  };
  // Direction arrow a little after the start line.
  const i0 = Math.min(60, n - 1);
  const c = g.center[i0]!;
  const d = g.center[(i0 + 1) % n]!;
  const ang = (Math.atan2(-(d[1] - c[1]), d[0] - c[0]) * 180) / Math.PI;
  const s = 14 * scale;
  return [
    `<path class="surface" fill-rule="evenodd" d="${path(g.left, true)}${path(g.right, true)}"/>`,
    `<path class="edge" stroke-width="${scale}" d="${path(g.left, true)}"/>`,
    `<path class="edge" stroke-width="${scale}" d="${path(g.right, true)}"/>`,
    `<path class="centre" stroke-width="${0.6 * scale}" stroke-dasharray="${4 * scale} ${4 * scale}" d="${path(g.center, true)}"/>`,
    ...t.gates.slice(1).map((i) => gate(i, "gate")),
    gate(t.gates[0]!, "start"),
    `<path class="arrow" transform="translate(${c[0]} ${-c[1]}) rotate(${ang})" d="M${s} 0L${-s * 0.6} ${s * 0.6}L${-s * 0.6} ${-s * 0.6}Z"/>`,
  ].join("\n");
}

function scaleBar(x: number, y: number, metres: number, scale: number): string {
  return `<g class="bar"><line x1="${x}" y1="${y}" x2="${x + metres}" y2="${y}" stroke-width="${2 * scale}"/>` +
    `<text x="${x}" y="${y - 6 * scale}" font-size="${14 * scale}">${metres} m</text></g>`;
}

function tightestCorner(t: TrackFile, g: Geometry): { index: number; radius: number } {
  const samples: Sample[] = g.center.map((p, i) => ({ x: p[0], y: p[1], wLeft: t.widthLeft[i]!, wRight: t.widthRight[i]! }));
  const k = smoothedCurvature(samples, 3);
  let index = 0;
  k.forEach((v, i) => {
    if (Math.abs(v) > Math.abs(k[index]!)) index = i;
  });
  return { index, radius: 1 / Math.abs(k[index]!) };
}

function car(g: Geometry, i: number, colors: { primary: string; secondary: string; accent: string }): string {
  const n = g.center.length;
  const c = g.center[i]!;
  const q = g.center[(i + 1) % n]!;
  const ang = (Math.atan2(-(q[1] - c[1]), q[0] - c[0]) * 180) / Math.PI;
  const L = SOLO_1_CAR.lengthM;
  const W = SOLO_1_CAR.widthM;
  return `<g transform="translate(${c[0]} ${-c[1]}) rotate(${ang})">` +
    `<rect x="${-L / 2}" y="${-W / 2}" width="${L}" height="${W}" rx="0.4" fill="${colors.primary}" stroke="${colors.accent}" stroke-width="0.12"/>` +
    `<rect x="${L / 2 - 1.2}" y="${-W / 2}" width="0.5" height="${W}" fill="${colors.secondary}"/>` +
    `</g>`;
}

function circuitSection(t: TrackFile, teamIdx: number): string {
  const g = geometry(t);
  const brand = circuitBrand(t.circuitId);
  const b = t.bounds;
  const pad = 40;
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const full = Math.max(w, h) / 900; // stroke scale: ~1 px at 900 px wide
  const corner = tightestCorner(t, g);
  const cc = g.center[corner.index]!;
  const zoom = 70; // metres either side
  const team = TEAMS[teamIdx % TEAMS.length]!;
  const minW = Math.min(...t.widthLeft.map((l, i) => l + t.widthRight[i]!));
  const maxW = Math.max(...t.widthLeft.map((l, i) => l + t.widthRight[i]!));

  return `<section>
  <h2>${brand.name} <span>${brand.location}</span></h2>
  <p class="meta">${t.lengthM.toFixed(1)} m baked vs ${t.officialLengthM} m official
    (${(((t.lengthM - t.officialLengthM) / t.officialLengthM) * 100).toFixed(2)}%) ·
    width ${minW.toFixed(1)}–${maxW.toFixed(1)} m · ${t.gates.length} gates · revision ${t.revision} ·
    ${t.source.kind} (${t.source.license}) · sha ${t.sha256.slice(0, 12)}</p>
  <div class="views">
    <svg class="full" viewBox="${b.minX - pad} ${-b.maxY - pad} ${w} ${h}">
      ${trackLayers(g, t, full)}
      <circle class="zoomring" cx="${cc[0]}" cy="${-cc[1]}" r="${zoom}" stroke-width="${2 * full}"/>
      ${scaleBar(b.minX, -b.minY + pad / 2, 500, full)}
    </svg>
    <figure>
      <svg class="zoom" viewBox="${cc[0] - zoom} ${-cc[1] - zoom} ${2 * zoom} ${2 * zoom}">
        ${trackLayers(g, t, 0.12)}
        ${car(g, corner.index, team.real.colors)}
        ${scaleBar(cc[0] - zoom + 6, -cc[1] + zoom - 6, 10, 0.12)}
      </svg>
      <figcaption>Tightest corner, centreline radius ≈ ${corner.radius.toFixed(1)} m.
        Car drawn at true size (${SOLO_1_CAR.lengthM} × ${SOLO_1_CAR.widthM} m, ${team.real.name} colours).</figcaption>
    </figure>
  </div>
</section>`;
}

const files = readdirSync(dataDir).filter((f) => f.endsWith(".track.json"));
const order = new Map<string, number>(CIRCUITS.map((c, i) => [c.id, i]));
const tracks = files
  .map((f) => JSON.parse(readFileSync(join(dataDir, f), "utf8")) as TrackFile)
  .sort((a, b) => (order.get(a.circuitId) ?? 99) - (order.get(b.circuitId) ?? 99));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>fevo track preview</title>
<style>
  :root { --bg:#f5f4ef; --fg:#1f1e1d; --muted:#6b6a68; --asphalt:#3a3a3c; --edge:#ffffff; --gate:#7fb2ff; --start:#e5484d; --card:#ffffff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#151514; --fg:#ecebe8; --muted:#9b9a97; --asphalt:#4a4a4e; --card:#1f1f1e; } }
  body { margin:0; padding:24px 16px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,-apple-system,sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:17px; margin:0; } h2 span { color:var(--muted); font-weight:400; }
  .meta, figcaption, .lede { color:var(--muted); font-size:13px; }
  section { background:var(--card); border-radius:10px; padding:16px; margin:16px 0; }
  .views { display:grid; grid-template-columns: 2fr 1fr; gap:16px; align-items:start; }
  @media (max-width: 760px) { .views { grid-template-columns: 1fr; } }
  svg { width:100%; height:auto; display:block; }
  figure { margin:0; }
  .surface { fill:var(--asphalt); } .edge { fill:none; stroke:var(--edge); }
  .centre { fill:none; stroke:#ffd166; opacity:.7; } .gate { stroke:var(--gate); opacity:.55; }
  .start { stroke:var(--start); } .arrow { fill:var(--start); }
  .zoomring { fill:none; stroke:var(--start); opacity:.8; } .bar line { stroke:var(--fg); } .bar text { fill:var(--fg); }
</style></head><body>
<h1>fevo track preview</h1>
<p class="lede">Baked from TUMFTM racetrack-database, 1 m spacing, true metres. Red line: start/finish (not yet checked against imagery). Blue lines: gates. Yellow dashes: centreline. Arrow: driving direction.</p>
${tracks.map((t, i) => circuitSection(t, [0, 1, 2][i] ?? i)).join("\n")}
</body></html>`;

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "preview.html"), html);
console.log(`wrote ${join(outDir, "preview.html")} (${tracks.length} tracks)`);
