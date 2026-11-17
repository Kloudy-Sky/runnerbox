import type { PullRequest } from "@runnerbox/contracts";
import { Link } from "@tanstack/react-router";
import { standingOf, standingWords } from "../../lib/pullStanding.ts";
import type { RootSearch } from "../../lib/search.ts";
import { StandingBar } from "../pulls/StandingBar.tsx";
import { OverviewSection } from "./OverviewSection.tsx";
import { RankedList } from "./RankedList.tsx";

const LATEST = 3;
const keep = (previous: RootSearch) => previous;

function PullLink({ pull }: { pull: PullRequest }) {
  const [owner = "", name = ""] = pull.repo.split("/");
  return (
    <Link to="/pulls/$owner/$name/$number" params={{ owner, name, number: String(pull.number) }} search={keep} className="hover:text-foreground">
      #{pull.number} {pull.title} · {pull.repo}
    </Link>
  );
}

// The open pull requests as one bar by where they stand, and the latest few to change.
export function PullsNow({ pulls, loaded }: { pulls: ReadonlyArray<PullRequest>; loaded: boolean }) {
  return (
    <OverviewSection title="Pull requests now" aside={loaded ? `${pulls.length} open` : null}>
      {loaded && pulls.length === 0 ? <p className="text-muted-foreground">No open pull requests on the repositories with reviews on.</p> : null}
      <StandingBar pulls={pulls} />
      <RankedList heading="Latest" rows={pulls.slice(0, LATEST).map((pull) => ({ key: `${pull.repo}#${pull.number}`, label: <PullLink pull={pull} />, value: standingWords[standingOf(pull)].toLowerCase() }))} />
    </OverviewSection>
  );
}
