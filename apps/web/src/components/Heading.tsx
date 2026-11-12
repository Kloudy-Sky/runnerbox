import type { ReactNode } from "react";

// A quiet label over a block of detail.
export const Heading = ({ children }: { children: ReactNode }) => <div className="pt-4 pb-1 text-muted-foreground text-xs">{children}</div>;
