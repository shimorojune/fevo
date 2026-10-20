import type { TrackFile } from "@fevo/tracks";
import { thumbnailPath } from "@/lib/replay";
import { cn } from "@/lib/utils";

/** A track's outline, drawn from its baked centreline. */
export function TrackOutline({ track, w = 34, h = 22, stroke = 1.6, className }: { track: TrackFile | undefined; w?: number; h?: number; stroke?: number; className?: string }) {
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className={cn("shrink-0", className)}>
      {track && <path d={thumbnailPath(track, w, h, stroke + 1)} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinejoin="round" />}
    </svg>
  );
}
