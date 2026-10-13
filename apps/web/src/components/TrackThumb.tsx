import type { TrackFile } from "@fevo/tracks";
import { thumbnailPath } from "../lib/replay";

export function TrackThumb({ track, w = 64, h = 38, stroke = 3 }: { track: TrackFile | undefined; w?: number; h?: number; stroke?: number }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {track && <path d={thumbnailPath(track, w, h, stroke + 1)} fill="none" stroke="#121417" strokeWidth={stroke} strokeLinejoin="round" />}
    </svg>
  );
}
