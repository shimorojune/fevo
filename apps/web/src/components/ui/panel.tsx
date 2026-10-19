import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A bordered panel on the page colour. No shadow: the border separates. */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card", className)} {...props} />;
}

export function PanelHeader({ className, ...props }: ComponentProps<"header">) {
  return <header className={cn("flex items-center justify-between gap-3 border-b border-border px-4 py-3 [&_h2]:m-0 [&_h2]:text-[13px] [&_h2]:font-medium", className)} {...props} />;
}

/** Native select styled as a pill, for model, track and ghost pickers. */
export function Pick({ label, className, children, ...props }: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
      {label}
      <select
        className={cn(
          "h-[30px] max-w-[220px] appearance-none rounded-full border border-border bg-background bg-[length:5px_5px,5px_5px] bg-[position:calc(100%-15px)_13px,calc(100%-10px)_13px] bg-no-repeat pr-7 pl-3 text-[12.5px] text-foreground transition-colors hover:border-muted-foreground",
          "bg-[image:linear-gradient(45deg,transparent_50%,var(--muted-foreground)_50%),linear-gradient(135deg,var(--muted-foreground)_50%,transparent_50%)]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Stat({ k, children, className }: { k: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className="font-mono text-[19px] font-light tracking-[-0.03em]">{children}</div>
    </div>
  );
}
