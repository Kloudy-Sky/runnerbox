import type { ReviewFinding } from "@runnerbox/contracts";

// The two priorities, told apart by a square of colour beside white text, so neither rests on
// colour alone. Both colours were checked against the app's charcoal for people who see colour
// differently.
const COLOR = { P1: "#d03b3b", P2: "#c98500" } as const;

export function PriorityMark({ priority, count }: { priority: ReviewFinding["priority"]; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className="size-2 rounded-[2px]" style={{ backgroundColor: COLOR[priority] }} aria-hidden />
      {count === undefined ? priority : `${count} ${priority}`}
    </span>
  );
}
