import { useParams } from "@tanstack/react-router";
import { Reading } from "../components/Reading.tsx";
import { ThreadColumn } from "../components/ThreadColumn.tsx";
import { Button } from "../components/ui/button.tsx";
import { Empty } from "../components/ui/empty.tsx";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatAge, jobName } from "../lib/format.ts";
import { runHappened, VERDICT_ACTION, VERDICT_WHY } from "../lib/vocabulary.ts";

// One job attempt in the same reading column as an inbox item.
export function RunPage() {
  const { jobId } = useParams({ strict: false });
  const { days } = useRange();
  const { repo } = useRepo();
  const runs = useRpcQuery(["runs", repo, days], (client) => client["history.runs"]({ repo: repo!, days, limit: 2000 }));
  const run = runs.data?.find((candidate) => String(candidate.jobId) === jobId);
  if (!run) {
    return runs.data ? (
      <Empty.Root className="mx-auto">
        <Empty.Title>This run isn't in the time range</Empty.Title>
        <Empty.Description>Pick a longer range, or open it from All runs.</Empty.Description>
      </Empty.Root>
    ) : null;
  }
  return (
    <ThreadColumn key={run.jobId} subject={{ _tag: "run", repo: run.repo, jobId: run.jobId }} placeholder="Ask about this run">
      {(thread) => (
        <Reading.Root>
          <Reading.Header>
            <Reading.Title>
              {jobName(run)} <span className="text-muted-foreground">#{run.runId}{run.attempt > 1 ? `, attempt ${run.attempt}` : ""}</span>
            </Reading.Title>
            <Reading.Meta>{[run.repo, run.headSha?.slice(0, 7), `${formatAge(run.createdAt)} ago`].filter(Boolean).join(", ")}</Reading.Meta>
          </Reading.Header>
          <Reading.Section heading="What happened">{runHappened(run)}</Reading.Section>
          {run.verdict ? (
            <>
              <Reading.Section heading="Why">{VERDICT_WHY[run.verdict]}</Reading.Section>
              <Reading.Section heading="What you can do">{VERDICT_ACTION[run.verdict]}</Reading.Section>
            </>
          ) : null}
          {thread.view.items.length === 0 && thread.permitted && thread.provider?.available ? (
            <Reading.Actions>
              <Button onClick={() => void thread.send(run.verdict ? "Is the verdict right, and what should I do?" : "Anything unusual about this run?")}>Ask the agent about this run</Button>
            </Reading.Actions>
          ) : null}
        </Reading.Root>
      )}
    </ThreadColumn>
  );
}
