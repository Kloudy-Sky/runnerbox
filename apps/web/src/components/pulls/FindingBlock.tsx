import type { ReviewFinding } from "@runnerbox/contracts";

const priorityWords = { P1: "Fix before merging", P2: "Worth a look" } as const satisfies Record<ReviewFinding["priority"], string>;

const lines = (finding: ReviewFinding) => (finding.endLine > finding.startLine ? `lines ${finding.startLine} to ${finding.endLine}` : `line ${finding.startLine}`);

// One finding: how much it matters, what's wrong and where, and the lines it points at as they
// are at the reviewed commit.
export function FindingBlock({ finding }: { finding: ReviewFinding }) {
  return (
    <div className="pt-3">
      <div>
        <span className={finding.priority === "P1" ? "mr-1.5 font-semibold text-destructive" : "mr-1.5 font-semibold text-muted-foreground"}>{priorityWords[finding.priority]}</span>
        <span className="font-medium">{finding.title}</span>
      </div>
      <p className="max-w-[80ch] text-muted-foreground">
        <span className="font-mono text-xs">{finding.path}</span>, {lines(finding)}. {finding.body}
      </p>
      {finding.rule ? <p className="max-w-[80ch] text-muted-foreground">Rule: "{finding.rule}"</p> : null}
      {finding.code.length > 0 ? (
        <pre className="mt-2 max-w-[680px] overflow-x-auto rounded-md bg-surface px-3 py-2 font-mono text-xs leading-relaxed">
          {finding.code.map(({ line, text }) => (
            <div key={line}>
              <span className="mr-2.5 inline-block min-w-7 select-none text-right text-muted-foreground/70 tabular-nums">{line}</span>
              {text}
            </div>
          ))}
        </pre>
      ) : null}
    </div>
  );
}
