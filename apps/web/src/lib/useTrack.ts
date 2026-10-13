import { useEffect, useState } from "react";
import type { TrackFile } from "@fevo/tracks";
import { loadTrackFile } from "./tracks";

export function useTrack(id: string | undefined): TrackFile | undefined {
  const [track, setTrack] = useState<TrackFile>();
  useEffect(() => {
    setTrack(undefined);
    if (!id) return;
    let live = true;
    loadTrackFile(id).then((t) => live && setTrack(t));
    return () => {
      live = false;
    };
  }, [id]);
  return track;
}

export function useAllTracks(ids: string[]): Record<string, TrackFile> {
  const [tracks, setTracks] = useState<Record<string, TrackFile>>({});
  useEffect(() => {
    let live = true;
    Promise.all(ids.map((id) => loadTrackFile(id).then((t) => [id, t] as const))).then((all) => live && setTracks(Object.fromEntries(all)));
    return () => {
      live = false;
    };
  }, [ids.join(",")]);
  return tracks;
}
