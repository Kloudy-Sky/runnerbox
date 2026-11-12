import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code's components/ui (MIT). Pick a `variant` and `size`; don't restyle a button
// with `className` beyond layout. One `default` (primary) button per screen.
const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--control-radius)] font-medium outline-none transition-[background-color,color,scale] [&:active:not([aria-haspopup])]:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        default: "h-8 px-3",
        sm: "h-7 gap-1.5 px-2.5",
        xs: "h-6 gap-1 px-2 text-xs",
        icon: "size-8",
        "icon-sm": "size-7",
      },
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "bg-accent text-foreground hover:bg-accent/70",
        ghost: "text-foreground hover:bg-accent",
        "ghost-muted": "text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "text-destructive hover:bg-destructive/10",
        link: "h-auto px-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
      },
    },
  },
);

type ButtonProps = useRender.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const defaultProps = { className: cn(buttonVariants({ className, size, variant })), "data-slot": "button", type: render ? undefined : ("button" as const) };
  return useRender({ defaultTagName: "button", props: mergeProps<"button">(defaultProps, props), render });
}

export { Button, buttonVariants };
