import { useParams } from "@tanstack/react-router";
import { JobResourcesView } from "../components/job/JobResourcesView.tsx";
import { PageBar } from "../components/PageBar.tsx";
import { RangeMenu } from "../components/RangeMenu.tsx";
import { Reading } from "../components/Reading.tsx";
import { ThreadColumn } from "../components/ThreadColumn.tsx";
import { Button } from "../components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty.tsx";
import { useJobResources } from "../hooks/useJobResources.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRuns } from "../hooks/useRuns.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";
import { formatAge, jobName } from "../lib/format.ts";
import { runHappened, VERDICT_ACTION, VERDICT_WHY } from "../lib/vocabulary.ts";

// One job attempt in the same reading column as an inbox item.
export function RunPage() {
  const { jobId } = useParams({ strict: false });
  const { days } = useRange();
  const { repo } = useRepo();
  const runs = useRuns(repo, days);
  const run = runs.data?.find((candidate) => String(candidate.jobId) === jobId);
  const resources = useJobResources(run);
  const { jobResources } = useServerCapabilities();
  // Everything under What happened waits for the readings, so the page arrives whole and a finding
  // never replaces the verdict's words after it has drawn.
  const settled = !jobResources || resources.isSuccess || resources.isError;
  // A specific finding from the readings is the Why, with its own advice, in place of the verdict's.
  const finding = resources.data?.sentence?.advice ? { why: resources.data.sentence.text, action: resources.data.sentence.advice } : null;
  const bar = (
    <PageBar title={run ? `${jobName(run)} #${run.runId}` : "Run"} trail={["All runs"]}>
      <RangeMenu />
    </PageBar>
  );
  if (!run) {
    return (
      <>
        {bar}
        {runs.data ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>This run isn't in the time range</EmptyTitle>
              <EmptyDescription>Pick a longer range, or open it from All runs.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
      </>
    );
  }
  return (
    <>
      {bar}
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
            {resources.data ? (
              <Reading.Section heading="Steps and what they used">
                <JobResourcesView resources={resources.data} sentenceShown={finding === null} />
              </Reading.Section>
            ) : null}
            {!settled ? null : finding ? (
              <>
                <Reading.Section heading="Why">{finding.why}</Reading.Section>
                <Reading.Section heading="What you can do">{finding.action}</Reading.Section>
              </>
            ) : run.verdict ? (
              <>
                <Reading.Section heading="Why">{VERDICT_WHY[run.verdict]}</Reading.Section>
                <Reading.Section heading="What you can do">{VERDICT_ACTION[run.verdict]}</Reading.Section>
              </>
            ) : null}
            {settled && thread.view.items.length === 0 && thread.permitted && thread.provider?.available ? (
              <Reading.Actions>
                <Button onClick={() => void thread.send(run.verdict ? "Is the verdict right, and what should I do?" : "Anything unusual about this run?")}>Ask the agent about this run</Button>
              </Reading.Actions>
            ) : null}
          </Reading.Root>
        )}
      </ThreadColumn>
    </>
  );
}
