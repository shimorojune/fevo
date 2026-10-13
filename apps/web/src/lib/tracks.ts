import type { TrackFile } from "@fevo/tracks";

const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  spielberg: () => import("@fevo/tracks/data/spielberg.track.json"),
  monza: () => import("@fevo/tracks/data/monza.track.json"),
  austin: () => import("@fevo/tracks/data/austin.track.json"),
};

export const TRACK_IDS = Object.keys(loaders);

const cache = new Map<string, Promise<TrackFile>>();

export function loadTrackFile(id: string): Promise<TrackFile> {
  const load = loaders[id];
  if (!load) return Promise.reject(new Error(`unknown circuit ${id}`));
  if (!cache.has(id)) cache.set(id, load().then((m) => m.default as TrackFile));
  return cache.get(id)!;
}
