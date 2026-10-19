import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** One or two words of state; colour only repeats the word. */
const badgeVariants = cva("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-0.5 text-xs", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      house: "bg-success/15 text-success",
      ok: "bg-success/15 text-success",
      run: "bg-driver-a/12 text-driver-a",
      bad: "bg-destructive/12 text-destructive",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, dot, live, children, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { dot?: boolean; live?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <i className={cn("size-1.5 rounded-full bg-current", live && "animate-pulse")} />}
      {children}
    </span>
  );
}
