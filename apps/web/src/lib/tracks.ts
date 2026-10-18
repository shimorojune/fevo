import type { TrackFile } from "@fevo/tracks";

/** Tracks baked into the build load without a round trip; any other track comes from the API. */
const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  spielberg: () => import("@fevo/tracks/data/spielberg.track.json"),
  monza: () => import("@fevo/tracks/data/monza.track.json"),
  austin: () => import("@fevo/tracks/data/austin.track.json"),
};

const cache = new Map<string, Promise<TrackFile>>();

async function fromApi(id: string): Promise<TrackFile> {
  const res = await fetch(`/api/tracks/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`unknown track ${id}`);
  return ((await res.json()) as { data: TrackFile }).data;
}

export function loadTrackFile(id: string): Promise<TrackFile> {
  if (!cache.has(id)) {
    const load = loaders[id];
    const p = load ? load().then((m) => m.default as TrackFile) : fromApi(id);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return cache.get(id)!;
}
