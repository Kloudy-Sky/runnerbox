import type { ChangeValue, Proposal } from "@runnerbox/contracts";
import { formatAge } from "./format.ts";

// A proposal's fields and fate in the app's words. Paths are the ones `up` allows.
const KIND = /^runners\.([a-z0-9]+)\.(.+)$/;
const FIELD: Record<string, string> = {
  slots: "jobs at once",
  "memoryFloor.hostMiB": "host memory kept free",
  "memoryFloor.vmMiB": "VM memory kept free",
  "limits.memory": "memory limit",
  "limits.memoryReservation": "memory reservation",
  "limits.memorySwap": "memory and swap limit",
  "limits.cpus": "CPU limit",
};

export function fieldWords(path: string) {
  const kind = KIND.exec(path);
  if (!kind) return FIELD[path] ? `${FIELD[path].charAt(0).toUpperCase()}${FIELD[path].slice(1)}` : path;
  return `${kind[1]}: ${FIELD[kind[2]!] ?? kind[2]}`;
}

export const valueWords = (path: string, value: ChangeValue) => (path.endsWith("MiB") ? `${value} MiB` : String(value));

// One line on where a proposal stands.
export function statusWords(proposal: Proposal, now = Date.now()) {
  const by = proposal.decidedBy ?? "someone";
  switch (proposal.status) {
    case "open": {
      const hours = Math.max(1, Math.round((Date.parse(proposal.expiresAt) - now) / 3_600_000));
      return `Waiting for your decision. Expires in ${hours}h.`;
    }
    case "expired":
      return "Expired without a decision.";
    case "declined":
      return `Declined by ${by}, ${formatAge(proposal.decidedAt, now)} ago.`;
    case "approved":
      return `Approved by ${by}. Applying it now.`;
    case "waiting":
      return `Approved by ${by}. Applies when no job is running, within 6 hours.`;
    case "applied":
      return `Applied, approved by ${by}.`;
    case "not_applied":
      return `Not applied: ${proposal.outcome ?? "no reason was given."}`;
  }
}
