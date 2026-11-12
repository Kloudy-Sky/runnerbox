import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT). A filled field with no border: runnerbox draws no control chrome.
type InputProps = Omit<InputPrimitive.Props & React.RefAttributes<HTMLInputElement>, "size"> & { size?: "sm" | "default"; font?: "default" | "mono" };

function Input({ className, size = "default", font = "default", ...props }: InputProps) {
  return (
    <span className={cn("relative inline-flex w-full rounded-[var(--control-radius)] bg-input text-foreground ring-ring/40 transition-shadow has-focus-visible:ring-2 has-disabled:opacity-50", font === "mono" && "font-mono", className)} data-slot="input-control">
      <InputPrimitive
        className={cn("h-8 w-full min-w-0 rounded-[inherit] bg-transparent px-2.5 outline-none placeholder:text-placeholder", size === "sm" && "h-7 px-2 text-[13px]")}
        data-slot="input"
        {...props}
      />
    </span>
  );
}

export { Input, type InputProps };
