import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT). A thin scrollbar that shows while scrolling or hovered.
function ScrollArea({ className, children, ...props }: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root className={cn("relative min-h-0 overflow-hidden", className)} data-slot="scroll-area" {...props}>
      <ScrollAreaPrimitive.Viewport className="h-full overscroll-contain outline-none" data-slot="scroll-area-viewport">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        className="m-0.5 flex w-1.5 justify-center rounded-full opacity-0 transition-opacity duration-150 data-hovering:opacity-100 data-scrolling:opacity-100"
        orientation="vertical"
      >
        <ScrollAreaPrimitive.Thumb className="w-full rounded-full bg-foreground/20" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

export { ScrollArea };
