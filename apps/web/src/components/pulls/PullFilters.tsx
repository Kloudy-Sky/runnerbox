import { STANDINGS, type Standing, standingWords } from "../../lib/pullStanding.ts";
import { cn } from "../../lib/utils.ts";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select.tsx";

const ALL = "all";

export type PullFilter = { readonly repo: string | null; readonly yours: boolean; readonly standing: Standing | null };

type Props = {
  readonly filter: PullFilter;
  readonly onChange: (filter: PullFilter) => void;
  readonly repos: ReadonlyArray<string>;
  // Whether any machine is signed in to GitHub, without which "yours" can't be told apart.
  readonly canTellYours: boolean;
};

const toggle = "px-2.5 py-1 disabled:cursor-not-allowed disabled:opacity-50";

// Which pull requests the table shows: one repository or all, everyone's or the signed-in
// account's, and all open ones or those in one standing.
export function PullFilters({ filter, onChange, repos, canTellYours }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {repos.length > 1 ? (
        <Select value={filter.repo ?? ALL} onValueChange={(value) => onChange({ ...filter, repo: value === null || value === ALL ? null : value })}>
          <SelectTrigger size="xs" variant="ghost" className="h-6 bg-accent text-xs sm:text-xs" aria-label="Repository">
            <SelectValue>{() => filter.repo ?? "All repositories"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={ALL}>All repositories</SelectItem>
            {repos.map((repo) => (
              <SelectItem key={repo} value={repo}>
                {repo}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <span className="flex overflow-hidden rounded-md bg-accent text-xs" role="group" aria-label="Whose">
        <button type="button" aria-pressed={!filter.yours} onClick={() => onChange({ ...filter, yours: false })} className={cn(toggle, !filter.yours ? "bg-foreground/15 text-foreground" : "text-muted-foreground")}>
          Everyone's
        </button>
        <button
          type="button"
          aria-pressed={filter.yours}
          disabled={!canTellYours}
          title={canTellYours ? "Opened by the account a machine is signed in to GitHub as" : "Sign a server in to GitHub to tell which are yours"}
          onClick={() => onChange({ ...filter, yours: true })}
          className={cn(toggle, filter.yours ? "bg-foreground/15 text-foreground" : "text-muted-foreground")}
        >
          Yours
        </button>
      </span>
      <Select value={filter.standing ?? ALL} onValueChange={(value) => onChange({ ...filter, standing: STANDINGS.find((standing) => standing === value) ?? null })}>
        <SelectTrigger size="xs" variant="ghost" className="h-6 bg-accent text-xs sm:text-xs" aria-label="Standing">
          <SelectValue>{() => (filter.standing === null ? "Open" : standingWords[filter.standing])}</SelectValue>
        </SelectTrigger>
        <SelectPopup>
          <SelectItem value={ALL}>Open</SelectItem>
          {STANDINGS.map((standing) => (
            <SelectItem key={standing} value={standing}>
              {standingWords[standing]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
