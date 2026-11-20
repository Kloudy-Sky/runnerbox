import { useNavigate } from "@tanstack/react-router";
import { useRepo } from "../hooks/useRepo.ts";
import type { RootSearch } from "../lib/search.ts";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select.tsx";

// Which repository a per-repository view shows, kept in the URL. With only one, it's named instead,
// except on a phone, where the page's bar has no room for a name that can't change.
export function RepoPicker() {
  const { repo, repos } = useRepo();
  const navigate = useNavigate();
  if (repos.length < 2) return <span className="truncate text-muted-foreground max-sm:hidden">{repo}</span>;
  return (
    <Select value={repo ?? null} onValueChange={(value) => value && void navigate({ to: ".", search: (previous: RootSearch) => ({ ...previous, repo: value }) })}>
      <SelectTrigger size="sm" className="w-auto min-w-0 font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {repos.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
