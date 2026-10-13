import { createHash } from "node:crypto";
import type { TrackFile, TrackSource } from "@fevo/tracks";
import { foldedSamples, loopLength, resampleClosed, roundMm, signedArea, type Sample } from "./geometry.ts";

export interface BakeOptions {
  circuitId: string;
  revision: number;
  source: TrackSource;
  officialLengthM: number;
  /** Rotate the raw loop so this point is on the start/finish line. */
  startIndex: number;
  spacingM: number;
  gateSpacingM: number;
  /** Maximum relative difference between baked and official length. */
  lengthTolerance: number;
}

export interface BakeReport {
  rawPoints: number;
  points: number;
  lengthM: number;
  lengthErrorPct: number;
  direction: "clockwise" | "counter-clockwise";
  minWidthM: number;
  maxWidthM: number;
  gates: number;
  foldedSamples: number[];
  errors: string[];
}

export function bakeTrack(raw: Sample[], opts: BakeOptions): { file: TrackFile; report: BakeReport } {
  const rotated = [...raw.slice(opts.startIndex), ...raw.slice(0, opts.startIndex)];
  const { samples, spacingM } = resampleClosed(rotated, opts.spacingM);
  const lengthM = loopLength(samples);
  const lengthError = (lengthM - opts.officialLengthM) / opts.officialLengthM;

  const widths = samples.map((s) => s.wLeft + s.wRight);
  const folded = foldedSamples(samples, spacingM);
  const gateCount = Math.max(1, Math.round(lengthM / opts.gateSpacingM));
  const gates = Array.from({ length: gateCount }, (_, k) => Math.round((k * samples.length) / gateCount));

  const errors: string[] = [];
  if (Math.abs(lengthError) > opts.lengthTolerance) {
    errors.push(
      `length ${lengthM.toFixed(1)} m is ${(lengthError * 100).toFixed(2)}% from official ${opts.officialLengthM} m`,
    );
  }
  if (folded.length > 0) errors.push(`${folded.length} samples where the inside edge folds over itself`);

  const centerline: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of samples) {
    const x = roundMm(s.x);
    const y = roundMm(s.y);
    centerline.push(x, y);
    // Bounds include the edges, so the renderer can frame the whole track.
    const w = Math.max(s.wLeft, s.wRight);
    minX = Math.min(minX, x - w);
    minY = Math.min(minY, y - w);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + w);
  }

  const body: Omit<TrackFile, "sha256"> = {
    schema: 1,
    circuitId: opts.circuitId,
    revision: opts.revision,
    source: opts.source,
    officialLengthM: opts.officialLengthM,
    lengthM: roundMm(lengthM),
    spacingM: roundMm(spacingM),
    centerline,
    widthLeft: samples.map((s) => roundMm(s.wLeft)),
    widthRight: samples.map((s) => roundMm(s.wRight)),
    gates,
    bounds: { minX: roundMm(minX), minY: roundMm(minY), maxX: roundMm(maxX), maxY: roundMm(maxY) },
  };
  const sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex");

  return {
    file: { ...body, sha256 },
    report: {
      rawPoints: raw.length,
      points: samples.length,
      lengthM,
      lengthErrorPct: lengthError * 100,
      direction: signedArea(samples) > 0 ? "counter-clockwise" : "clockwise",
      minWidthM: Math.min(...widths),
      maxWidthM: Math.max(...widths),
      gates: gateCount,
      foldedSamples: folded,
      errors,
    },
  };
}
