import * as Menu from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;

export function DropdownMenuContent({ className, sideOffset = 8, ...props }: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[232px] origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,.14)] data-[state=open]:animate-[menuin_160ms_cubic-bezier(.2,.8,.2,1)]",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item className={cn("flex cursor-pointer items-center rounded-sm px-2.5 py-2 text-[13px] outline-none transition-colors data-[highlighted]:bg-muted", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("flex flex-col px-2.5 pt-2 pb-2.5", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}
