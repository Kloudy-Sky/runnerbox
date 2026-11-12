import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT).
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full p-[2px] outline-none transition-[background-color] duration-200 focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary data-unchecked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[14px] rounded-full bg-muted-foreground transition-[translate,background-color] duration-150 data-checked:translate-x-[12px] data-checked:bg-primary-foreground" data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
