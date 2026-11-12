import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT). Opens with a short scale and fade.
const Menu = MenuPrimitive.Root;

function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />;
}

function MenuPopup({ className, align = "start", sideOffset = 4, ...props }: MenuPrimitive.Popup.Props & { align?: MenuPrimitive.Positioner.Props["align"]; sideOffset?: number }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner className="z-50 outline-none" align={align} sideOffset={sideOffset} collisionPadding={5}>
        <MenuPrimitive.Popup
          className={cn(
            "min-w-44 origin-(--transform-origin) rounded-lg bg-popover p-1 text-foreground shadow-xl shadow-black/50 outline-none transition-[scale,opacity] duration-150 data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0",
            className,
          )}
          data-slot="menu-popup"
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuItem({ className, variant = "default", ...props }: MenuPrimitive.Item.Props & { variant?: "default" | "destructive" }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex min-h-7 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 outline-none data-disabled:opacity-50 data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "destructive" && "text-destructive",
        className,
      )}
      data-slot="menu-item"
      {...props}
    />
  );
}

function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return <MenuPrimitive.GroupLabel className={cn("px-2 py-1 text-muted-foreground text-xs", className)} data-slot="menu-label" {...props} />;
}

const MenuGroup = MenuPrimitive.Group;

export { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger };
