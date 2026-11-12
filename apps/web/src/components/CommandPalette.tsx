import { inboxItems } from "@runnerbox/contracts";
import { useNavigate } from "@tanstack/react-router";
import { CircleDot, FileText, Gauge, House, ListTree, Server, Settings } from "lucide-react";
import { useInbox } from "../hooks/useInbox.ts";
import { useRange } from "../hooks/useRange.ts";
import { useRepo } from "../hooks/useRepo.ts";
import { useRpcQuery } from "../hooks/useRpcQuery.ts";
import { formatAge, jobName } from "../lib/format.ts";
import type { RootSearch } from "../lib/search.ts";
import { Command, CommandCollection, CommandDialog, CommandDialogPopup, CommandEmpty, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList } from "./ui/command.tsx";

type Entry = { id: string; label: string; detail: string; icon: typeof House; go: () => void };

// T3 Code's command palette: jump to a page, an inbox item or a recent run by typing part of it.
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const inbox = useInbox().data;
  const { days } = useRange();
  const { repo } = useRepo();
  const runs = useRpcQuery(["runs", repo, days], (client) => client["history.runs"]({ repo: repo!, days, limit: 2000 }));
  const keep = (previous: RootSearch) => previous;
  const page = (id: string, label: string, to: "/" | "/runs" | "/speed" | "/runners" | "/settings", icon: typeof House): Entry => ({ id, label, detail: "", icon, go: () => void navigate({ to, search: keep }) });
  const groups = [
    {
      value: "Pages",
      items: [page("home", "Home", "/", House), page("runs", "All runs", "/runs", ListTree), page("speed", "Speed and cost", "/speed", Gauge), page("runners", "Runners", "/runners", Server), page("settings", "Settings", "/settings", Settings)],
    },
    {
      value: "Inbox",
      items: (inbox ? inboxItems(inbox) : []).map((item): Entry => ({
        id: item.id,
        label: item.title,
        detail: item.group === "needs_you" ? "needs you" : "nothing to do",
        icon: CircleDot,
        go: () => void navigate({ to: "/item/$itemId", params: { itemId: item.id }, search: keep }),
      })),
    },
    {
      value: "Recent runs",
      items: (runs.data ?? []).slice(0, 100).map((run): Entry => ({
        id: `run:${run.jobId}`,
        label: `${jobName(run)} #${run.runId}`,
        detail: `${run.branch ?? ""} ${formatAge(run.createdAt)} ago`.trim(),
        icon: FileText,
        go: () => void navigate({ to: "/runs/$jobId", params: { jobId: String(run.jobId) }, search: keep }),
      })),
    },
  ].filter((group) => group.items.length > 0);
  // What typing matches against, by entry.
  const searchText = new WeakMap<object, string>(groups.flatMap((group) => group.items.map((entry) => [entry, `${entry.label} ${entry.detail}`] as const)));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup aria-label="Jump to">
        <Command items={groups} itemToStringValue={(entry) => (typeof entry === "object" && entry !== null ? (searchText.get(entry) ?? "") : "")}>
          <CommandInput placeholder="Jump to a page, item or run" />
          <CommandEmpty>Nothing matches.</CommandEmpty>
          <CommandList>
            {(group: (typeof groups)[number]) => (
              <CommandGroup key={group.value} items={group.items}>
                <CommandGroupLabel>{group.value}</CommandGroupLabel>
                <CommandCollection>
                  {(entry: Entry) => (
                    <CommandItem
                      key={entry.id}
                      value={entry}
                      onClick={() => {
                        entry.go();
                        onOpenChange(false);
                      }}
                    >
                      <entry.icon />
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      <span className="text-muted-foreground text-xs">{entry.detail}</span>
                    </CommandItem>
                  )}
                </CommandCollection>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
