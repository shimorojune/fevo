/**
 * Every team name, livery and circuit name the platform shows comes from here.
 *
 * Real team and circuit names are trademarks of their owners. To switch the
 * whole platform to neutral branding, flip BRANDING_MODE to "generic".
 * Nothing outside this package should hard-code a team or circuit name or colour.
 */
export type BrandingMode = "real" | "generic";

export const BRANDING_MODE: BrandingMode = "real";

export interface LiveryColors {
  primary: string;
  secondary: string;
  accent: string;
}

export interface TeamBrand {
  name: string;
  shortName: string;
  colors: LiveryColors;
}

export interface Team {
  /** Stable id stored in the database. Never rename. */
  id: string;
  real: TeamBrand;
  generic: TeamBrand;
}

export interface CircuitBrand {
  name: string;
  location: string;
}

export interface Circuit {
  /** Stable id, matches the baked track file name. Never rename. */
  id: string;
  real: CircuitBrand;
  generic: CircuitBrand;
}

/** Colours are approximate. Cosmetic only: every car is mechanically identical. */
export const TEAMS = [
  team("red-bull", ["Red Bull Racing", "RBR"], ["Team Navy", "NAV"], ["#1E2A5A", "#DB0A40", "#FFC906"]),
  team("ferrari", ["Scuderia Ferrari", "FER"], ["Team Scarlet", "SCA"], ["#DC0000", "#111111", "#FFEB00"]),
  team("mercedes", ["Mercedes-AMG", "MER"], ["Team Silver", "SIL"], ["#1B1B1B", "#C6C6C6", "#00D7B6"]),
  team("mclaren", ["McLaren", "MCL"], ["Team Papaya", "PAP"], ["#FF8000", "#111111", "#47C7FC"]),
  team("aston-martin", ["Aston Martin", "AMR"], ["Team Racing Green", "GRN"], ["#00594F", "#0B1F1C", "#CEDC00"]),
  team("alpine", ["Alpine", "ALP"], ["Team Azure", "AZU"], ["#0090FF", "#111111", "#FF87BC"]),
  team("williams", ["Williams", "WIL"], ["Team Ocean", "OCE"], ["#041E42", "#FFFFFF", "#00A3E0"]),
  team("racing-bulls", ["Racing Bulls", "RB"], ["Team Ivory", "IVO"], ["#F2F4F7", "#1434CB", "#E30613"]),
  team("haas", ["Haas", "HAA"], ["Team Graphite", "GRA"], ["#FFFFFF", "#111111", "#E6002B"]),
  team("audi", ["Audi", "AUD"], ["Team Titanium", "TIT"], ["#B4B8BB", "#111111", "#F50537"]),
  team("cadillac", ["Cadillac", "CAD"], ["Team Onyx", "ONX"], ["#111111", "#FFFFFF", "#C9A35A"]),
] as const;

export const CIRCUITS = [
  circuit("spielberg", ["Red Bull Ring", "Spielberg, Austria"], ["Spielberg", "Styria, Austria"]),
  circuit("monza", ["Autodromo Nazionale Monza", "Monza, Italy"], ["Monza", "Lombardy, Italy"]),
  circuit("austin", ["Circuit of the Americas", "Austin, USA"], ["Austin", "Texas, USA"]),
] as const;

export type TeamId = (typeof TEAMS)[number]["id"];
export type CircuitId = (typeof CIRCUITS)[number]["id"];

export function teamBrand(id: string, mode: BrandingMode = BRANDING_MODE): TeamBrand {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown team: ${id}`);
  return t[mode];
}

export function circuitBrand(id: string, mode: BrandingMode = BRANDING_MODE): CircuitBrand {
  const c = CIRCUITS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown circuit: ${id}`);
  return c[mode];
}

function team<const I extends string>(
  id: I,
  [realName, realShort]: [string, string],
  [genericName, genericShort]: [string, string],
  [primary, secondary, accent]: [string, string, string],
): Team & { id: I } {
  const colors = { primary, secondary, accent };
  return {
    id,
    real: { name: realName, shortName: realShort, colors },
    generic: { name: genericName, shortName: genericShort, colors },
  };
}

function circuit<const I extends string>(
  id: I,
  [realName, realLoc]: [string, string],
  [genName, genLoc]: [string, string],
): Circuit & { id: I } {
  return { id, real: { name: realName, location: realLoc }, generic: { name: genName, location: genLoc } };
}
