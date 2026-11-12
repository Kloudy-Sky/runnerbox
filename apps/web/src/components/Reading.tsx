import type * as React from "react";
import { cn } from "../lib/utils.ts";

// The reading column, as slots in the manner of T3 Code's ComposerBanner: about 640px of normal
// type, the title first, then short sections, one primary action, and detail collapsed.
export const Reading = {
  Root: ({ className, ...props }: React.ComponentProps<"article">) => (
    <article className={cn("mx-auto flex w-full max-w-(--reading-width) flex-col gap-5 px-6 pt-8 pb-6", className)} data-slot="reading" {...props} />
  ),
  Header: ({ className, ...props }: React.ComponentProps<"header">) => <header className={cn("flex flex-col gap-1", className)} data-slot="reading-header" {...props} />,
  Title: ({ className, ...props }: React.ComponentProps<"h1">) => <h1 className={cn("text-xl font-medium leading-snug text-balance", className)} data-slot="reading-title" {...props} />,
  Meta: ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("text-muted-foreground", className)} data-slot="reading-meta" {...props} />,
  Section: ({ heading, className, children, ...props }: React.ComponentProps<"section"> & { heading: React.ReactNode }) => (
    <section className={cn("flex flex-col gap-1", className)} data-slot="reading-section" {...props}>
      <h2 className="font-medium">{heading}</h2>
      <div className="text-foreground/90">{children}</div>
    </section>
  ),
  Actions: ({ className, ...props }: React.ComponentProps<"div">) => <div className={cn("flex flex-wrap items-center gap-2", className)} data-slot="reading-actions" {...props} />,
};
