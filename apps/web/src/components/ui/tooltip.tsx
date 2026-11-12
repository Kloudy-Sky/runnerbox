import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT). Fades and scales in, then holds still.
const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipPopup({ className, side = "top", sideOffset = 4, ...props }: TooltipPrimitive.Popup.Props & { side?: TooltipPrimitive.Positioner.Props["side"]; sideOffset?: number }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner className="z-[140]" side={side} sideOffset={sideOffset} collisionPadding={5}>
        <TooltipPrimitive.Popup
          className={cn(
            "max-w-80 origin-(--transform-origin) rounded-md bg-popover px-2 py-1 text-foreground text-xs leading-snug shadow-lg shadow-black/40 transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0",
            className,
          )}
          data-slot="tooltip-popup"
          {...props}
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger };
