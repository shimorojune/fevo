/**
 * Source data per circuit. Display names live in @fevo/branding.
 * officialLengthM is the published lap length used to validate geometry.
 */
export interface CircuitSource {
  id: string;
  tumftmFile: string;
  officialLengthM: number;
  /**
   * Start/finish line as an index into the raw TUMFTM points. 0 until each
   * circuit is checked against imagery: TUMFTM does not guarantee its first
   * point is on the line.
   */
  startIndex: number;
}

export const TUMFTM_BASE_URL = "https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks";
export const TUMFTM_LICENSE = "LGPL-3.0";

export const CIRCUIT_SOURCES: Record<string, CircuitSource> = {
  spielberg: { id: "spielberg", tumftmFile: "Spielberg.csv", officialLengthM: 4318, startIndex: 0 },
  monza: { id: "monza", tumftmFile: "Monza.csv", officialLengthM: 5793, startIndex: 0 },
  austin: { id: "austin", tumftmFile: "Austin.csv", officialLengthM: 5513, startIndex: 0 },
};
