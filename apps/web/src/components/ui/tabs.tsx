import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** Inspector tabs: a soft pill slides to the selected tab. */
export function TabsList({ className, children, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('[data-state="active"]');
      if (on) setPos({ left: on.offsetLeft, width: on.offsetWidth });
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(el, { subtree: true, attributes: true, attributeFilter: ["data-state"] });
    return () => mo.disconnect();
  }, []);
  return (
    <TabsPrimitive.List ref={ref} className={cn("relative flex gap-1 border-b border-border p-2", className)} {...props}>
      {pos && <span aria-hidden className="absolute top-2 bottom-2 rounded-sm bg-muted transition-[left,width] duration-[260ms] ease-[cubic-bezier(.2,.8,.2,1)]" style={{ left: pos.left, width: pos.width }} />}
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn("relative z-10 rounded-sm px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground", className)} {...props} />;
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("scroll-panel flex flex-1 flex-col gap-[18px] px-4 pt-3.5 pb-[18px] data-[state=active]:animate-rise", className)} {...props} />;
}
