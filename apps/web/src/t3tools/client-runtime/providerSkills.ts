// A stand-in of runnerbox's, not T3 Code's file: the one skill check the copied composer makes,
// as T3 Code's own. Runnerbox's server lists no skills.
import type { ServerProviderSkill } from "@t3tools/contracts";

export const isProviderSkillUserInvocable = (skill: Pick<ServerProviderSkill, "enabled" | "userInvocable">) => skill.enabled && skill.userInvocable !== false;
