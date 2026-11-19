import type { CiVariable } from "@runnerbox/contracts";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.ts";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuTrigger } from "../ui/menu.tsx";

// A runner on this machine, and why a job that reads the variable couldn't run there, if it couldn't.
export type RunOnChoice = { readonly label: string; readonly unfit: string | null };

const segment = (on: boolean) =>
  cn(
    "flex h-6 items-center gap-1 px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50",
    on ? "bg-foreground font-medium text-background" : "text-muted-foreground enabled:hover:text-foreground",
  );

// Where the jobs reading one runner variable run: GitHub, or a runner on this machine. With one
// runner that fits, Here moves at once; with more, it opens them, and one a job couldn't run on is
// listed with why but can't be picked. Once moved, Here names the runner.
export function RunOn({ variable, choices, disabled, onChoose }: { variable: CiVariable; choices: ReadonlyArray<RunOnChoice>; disabled: boolean; onChoose: (label: string | null) => void }) {
  const fitting = choices.filter((choice) => choice.unfit === null);
  const here = choices.find((choice) => choice.label === variable.value) ?? null;
  const onGitHub = variable.value === null && variable.org === null;
  const noFit = fitting.length === 0 ? (choices[0]?.unfit ?? "No runner on this machine serves these jobs.") : undefined;
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border" role="group" aria-label={`Run jobs that read ${variable.name} on`}>
      <button
        type="button"
        aria-pressed={onGitHub}
        disabled={disabled || variable.org !== null}
        title={variable.org !== null ? "The organization sets this variable, so the repository's can't send its jobs to GitHub." : undefined}
        className={segment(onGitHub)}
        onClick={() => !onGitHub && onChoose(null)}
      >
        GitHub
      </button>
      {fitting.length > 1 ? (
        <Menu>
          <MenuTrigger render={<button type="button" aria-pressed={here !== null} disabled={disabled} className={segment(here !== null)} />}>
            {here?.label ?? "Here"}
            <ChevronDown className="size-3" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-56">
            {choices.map((choice) => (
              <MenuItem key={choice.label} disabled={choice.unfit !== null || choice.label === variable.value} onClick={() => onChoose(choice.label)}>
                <span>{choice.label}</span>
                {choice.unfit !== null ? <MenuItemDetail>{choice.unfit}</MenuItemDetail> : choice.label === variable.value ? <MenuItemDetail>now</MenuItemDetail> : null}
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      ) : (
        <button type="button" aria-pressed={here !== null} disabled={disabled || noFit !== undefined} title={noFit} className={segment(here !== null)} onClick={() => here === null && fitting[0] && onChoose(fitting[0].label)}>
          {here?.label ?? "Here"}
        </button>
      )}
    </div>
  );
}
