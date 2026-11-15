// A stand-in of runnerbox's, not T3 Code's file: a provider skill's chip. Runnerbox offers no skills,
// so the composer never makes one; this only has to render its label.
import type { ServerProviderSkill } from "@t3tools/contracts";

export function SkillChipPopover({ label }: { label: string; description: string | null; onViewInstructions: (() => void) | undefined }) {
  return <span>{label}</span>;
}

export const skillPopoverDescription = (skill: ServerProviderSkill) => skill.shortDescription ?? skill.description ?? null;
