import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedItem<V extends string> {
  value: V;
  label: React.ReactNode;
}

/** Picks one of a few options. A thumb slides to the chosen one. */
export function Segmented<V extends string>({ items, value, onChange, label, className }: { items: SegmentedItem<V>[]; value: V; onChange: (v: V) => void; label: string; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number; instant: boolean } | null>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const place = (instant: boolean) => {
      const el = root.current?.querySelector<HTMLElement>(`[data-state="on"]`);
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth, instant });
    };
    place(first.current);
    first.current = false;
    const ro = new ResizeObserver(() => place(true));
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [value, items.length]);
  return (
    <ToggleGroup.Root
      ref={root}
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      aria-label={label}
      className={cn("relative inline-flex rounded-full bg-muted p-0.5", className)}
    >
      {thumb && (
        <span
          aria-hidden
          className={cn("absolute top-0.5 bottom-0.5 rounded-full bg-background shadow-[0_0_0_1px_var(--border)]", !thumb.instant && "transition-[left,width] duration-[260ms] ease-[cubic-bezier(.2,.8,.2,1)]")}
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {items.map((it) => (
        <ToggleGroup.Item
          key={it.value}
          value={it.value}
          className="relative z-10 rounded-full px-[11px] py-1 text-[12.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground active:scale-[.96] data-[state=on]:text-foreground"
        >
          {it.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
