import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Pill buttons. Primary is ink and inverts with the theme; colour is kept for data. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border text-[12.5px] transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground hover:opacity-85",
        outline: "border-border bg-background text-foreground hover:border-muted-foreground",
        ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "border-destructive bg-destructive text-white hover:opacity-85",
      },
      size: { default: "h-[30px] px-[13px]", sm: "h-[26px] px-2.5 text-xs", lg: "h-[38px] px-[18px] text-[13px]", icon: "size-[30px] px-0" },
    },
    defaultVariants: { variant: "outline", size: "default" },
  },
);

export function Button({ className, variant, size, asChild = false, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
