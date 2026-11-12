import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils.ts";
import { Button } from "./button.tsx";

// Ported from T3 Code's sidebar (MIT), for a desktop window: fixed width, collapses off canvas
// with one width transition, and remembers whether it was open. T3's resize rail and mobile sheet
// are left out.

const STORAGE_KEY = "runnerbox.sidebar.open";

type SidebarContextValue = { open: boolean; setOpen: (open: boolean) => void; toggle: () => void };
const SidebarContext = React.createContext<SidebarContextValue | null>(null);

function useSidebar() {
  const context = React.use(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
  return context;
}

const readOpen = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

function SidebarProvider({ className, children, ...props }: React.ComponentProps<"div">) {
  const [open, setOpenState] = React.useState(readOpen);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // A browser without storage still toggles, it just won't remember.
    }
  };
  const toggle = () => setOpen(!open);
  // Cmd+B or Ctrl+B, as in T3 Code. A key press is outside React, so this subscribes to it.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpenState((current) => {
          try {
            localStorage.setItem(STORAGE_KEY, String(!current));
          } catch {
            // As above.
          }
          return !current;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <SidebarContext value={{ open, setOpen, toggle }}>
      <div className={cn("flex h-full w-full", className)} data-slot="sidebar-wrapper" {...props}>
        {children}
      </div>
    </SidebarContext>
  );
}

function Sidebar({ className, children, ...props }: React.ComponentProps<"aside">) {
  const { open } = useSidebar();
  return (
    <aside
      className={cn("h-full shrink-0 overflow-hidden bg-sidebar transition-[width] duration-200 ease-(--ease-drawer)", open ? "w-(--sidebar-width)" : "w-0", className)}
      data-slot="sidebar"
      data-state={open ? "expanded" : "collapsed"}
      inert={!open}
      {...props}
    >
      <div className="flex h-full w-(--sidebar-width) flex-col">{children}</div>
    </aside>
  );
}

function SidebarTrigger({ className, ...props }: React.ComponentProps<typeof Button>) {
  const { open, toggle } = useSidebar();
  return (
    <Button variant="ghost-muted" size="icon-sm" className={className} aria-label={open ? "Hide sidebar" : "Show sidebar"} onClick={toggle} data-slot="sidebar-trigger" {...props}>
      <PanelLeft />
    </Button>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return <main className={cn("relative flex min-w-0 flex-1 flex-col bg-background", className)} data-slot="sidebar-inset" {...props} />;
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-2", className)} data-slot="sidebar-header" {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)} data-slot="sidebar-content" {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2 p-2", className)} data-slot="sidebar-footer" {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex w-full min-w-0 flex-col px-2 py-1.5", className)} data-slot="sidebar-group" {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex h-7 items-center px-2.5 text-muted-foreground text-xs", className)} data-slot="sidebar-group-label" {...props} />;
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul className={cn("flex w-full min-w-0 flex-col gap-0.5", className)} data-slot="sidebar-menu" {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li className={cn("group/menu-item relative enter", className)} data-slot="sidebar-menu-item" {...props} />;
}

const sidebarMenuButtonVariants = cva(
  "flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[var(--control-radius)] px-2.5 text-left outline-none transition-colors hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-sidebar-row-selected [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground",
  {
    defaultVariants: { size: "default" },
    variants: {
      size: {
        default: "h-8",
        // Two lines: a title, and a quieter line under it.
        lg: "min-h-12 items-start py-1.5",
      },
    },
  },
);

function SidebarMenuButton({
  isActive = false,
  size,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & { isActive?: boolean } & VariantProps<typeof sidebarMenuButtonVariants>) {
  const defaultProps = { className: cn(sidebarMenuButtonVariants({ size }), className), "data-active": isActive, "data-slot": "sidebar-menu-button" };
  return useRender({ defaultTagName: "button", props: mergeProps<"button">(defaultProps, props), render });
}

// A count or short status at the end of a row.
function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("pointer-events-none absolute top-1.5 right-2 text-muted-foreground text-xs tabular-nums", className)} data-slot="sidebar-menu-badge" {...props} />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
};
