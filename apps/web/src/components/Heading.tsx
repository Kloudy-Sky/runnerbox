import type { ReactNode } from "react";

export const Heading = ({ children }: { children: ReactNode }) => (
  <div className="pt-4 pb-1 text-[11px] tracking-wide text-dim uppercase">{children}</div>
);
