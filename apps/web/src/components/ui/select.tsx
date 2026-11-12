import { Select as SelectPrimitive } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT).
const Select = SelectPrimitive.Root;

function SelectTrigger({ className, children, size = "default", ...props }: SelectPrimitive.Trigger.Props & { size?: "default" | "sm" }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "inline-flex cursor-pointer items-center justify-between gap-1.5 rounded-[var(--control-radius)] text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent",
        size === "default" ? "h-8 px-2.5" : "h-7 px-2 text-[13px]",
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-muted-foreground">
        <ChevronDown className="size-3.5" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

const SelectValue = SelectPrimitive.Value;

function SelectPopup({ className, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner className="z-50" alignItemWithTrigger={false} sideOffset={4} collisionPadding={5}>
        <SelectPrimitive.Popup
          className={cn(
            "min-w-(--anchor-width) origin-(--transform-origin) rounded-lg bg-popover p-1 text-foreground shadow-xl shadow-black/50 outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          data-slot="select-popup"
          {...props}
        />
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      className={cn("flex min-h-7 cursor-default select-none items-center rounded-md px-2 py-1 outline-none data-highlighted:bg-accent data-selected:font-medium", className)}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue };
