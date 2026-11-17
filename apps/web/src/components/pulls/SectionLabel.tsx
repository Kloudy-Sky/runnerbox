import type { ReactNode } from "react";

// A section's title on Pull requests: small monospace capitals.
export const SectionLabel = ({ children }: { children: ReactNode }) => <div className="pt-3 pb-1 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.09em]">{children}</div>;
