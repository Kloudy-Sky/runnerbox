import type { ReactNode } from "react";

// What a settings page is for, above its sections and lined up with their titles. T3 Code's pages
// have no such line; runnerbox's keep theirs.
export function SettingsIntro({ children }: { children: ReactNode }) {
  return <p className="max-w-2xl px-3 text-pretty text-muted-foreground sm:px-4">{children}</p>;
}
