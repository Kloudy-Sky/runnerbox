import type { Check, PullRequest } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { useRange } from "../../hooks/useRange.ts";
import { useRpcQueryEverywhere } from "../../hooks/useRpcQueryEverywhere.ts";
import { checkTime } from "../../lib/checkWords.ts";
import { inboxRows } from "../../lib/inboxRows.ts";
import { machineFailureFor } from "../../lib/machineFailure.ts";
import type { RootSearch } from "../../lib/search.ts";
import { SectionLabel } from "./SectionLabel.tsx";

const keepSearch = (previous: RootSearch) => previous;

const mark = { passed: "✓", failed: "✕", running: "●", waiting: "○", skipped: "-", cancelled: "-" } as const satisfies Record<Check["state"], string>;
const tone = { passed: "text-muted-foreground", failed: "text-destructive", running: "text-foreground", waiting: "text-muted-foreground", skipped: "text-muted-foreground", cancelled: "text-muted-foreground" } as const satisfies Record<Check["state"], string>;

function said(check: Check) {
  const time = checkTime(check);
  if (check.state === "waiting") return `${check.name}, waiting for a runner`;
  if (check.state === "skipped" || check.state === "cancelled") return `${check.name}, ${check.state}`;
  return time ? `${check.name}, ${time}` : check.name;
}

// An opened pull request's checks by name, with their state and time, and, for one that failed
// because of a machine, the inbox item that says so, from the Inbox's list across every machine.
// Each machine's copy is looked in, since only one may hold an attempt on the head commit.
export function PullChecks({ pull }: { pull: PullRequest }) {
  const { days } = useRange();
  const inboxes = useRpcQueryEverywhere(["inbox", days], (client) => client["inbox.list"]({ days }));
  const all = inboxRows(inboxes.map((answer) => ({ environmentId: answer.environment.environmentId, inbox: answer.data }))).all.flatMap((row) => row.copies.map((copy) => copy.item));
  const checks = pull.checks ?? [];
  const failures = checks.flatMap((check) => {
    const item = machineFailureFor(pull, check, all);
    return item === null ? [] : [item];
  });
  return (
    <div>
      <SectionLabel>Checks</SectionLabel>
      {pull.checks === undefined ? (
        <p className="text-muted-foreground">This server doesn't report checks yet. Update it from Settings, under About.</p>
      ) : checks.length === 0 ? (
        <p className="text-muted-foreground">No checks on the newest commit yet.</p>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {checks.map((check) => (
            <span key={`${check.workflow}\0${check.name}`} className={tone[check.state]} title={check.workflow ?? undefined}>
              {mark[check.state]} {said(check)}
            </span>
          ))}
        </div>
      )}
      {failures.map((item) => (
        <p key={item.id} className="pt-1 text-muted-foreground">
          {item.title}.{" "}
          <Link to="/inbox/$itemId" params={{ itemId: item.id }} search={keepSearch} className="underline underline-offset-2 hover:text-foreground">
            See it in Inbox
          </Link>
        </p>
      ))}
    </div>
  );
}
