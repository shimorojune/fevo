/**
 * Baked track file. Produced by tools/track-builder, consumed by the sim.
 *
 * All coordinates are metres in a local planar frame, y up. Points run in
 * driving direction and the loop is closed implicitly (last point joins the
 * first). Index 0 is on the start/finish line.
 *
 * Values are rounded to the millimetre when baked. JSON number parsing is
 * correctly rounded in every engine, so every runtime sees identical doubles.
 */
export const TRACK_SCHEMA_VERSION = 1;

export interface TrackSource {
  kind: "tumftm" | "orthophoto-trace";
  file: string;
  url: string;
  license: string;
}

export interface TrackFile {
  schema: typeof TRACK_SCHEMA_VERSION;
  /** Matches a circuit id in @fevo/branding. Display names live there, not here. */
  circuitId: string;
  /** Bumped whenever geometry changes. A rules version pins one revision. */
  revision: number;
  source: TrackSource;
  officialLengthM: number;
  lengthM: number;
  spacingM: number;
  /** Interleaved centreline [x0, y0, x1, y1, ...]. */
  centerline: number[];
  /** Distance from the centreline to the left edge, per point. */
  widthLeft: number[];
  /** Distance from the centreline to the right edge, per point. */
  widthRight: number[];
  /** Centreline indices of gates, in driving order. gates[0] is the start/finish line. */
  gates: number[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** SHA-256 of the canonical JSON of every other field. */
  sha256: string;
}
