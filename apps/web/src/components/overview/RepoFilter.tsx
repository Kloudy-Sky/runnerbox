import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button.tsx";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu.tsx";

const ALL = "";

// All repositories, or one, in the same menu as the machine filter beside it. `picked` is null for all.
export function RepoFilter({ repos, picked, onPick }: { repos: ReadonlyArray<string>; picked: string | null; onPick: (repo: string | null) => void }) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="compact" />}>
        {picked ?? "All repositories"}
        <ChevronDown className="text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-44">
        <MenuRadioGroup value={picked ?? ALL} onValueChange={(value) => onPick(value === ALL ? null : value)}>
          <MenuRadioItem value={ALL}>All repositories</MenuRadioItem>
          {repos.map((repo) => (
            <MenuRadioItem key={repo} value={repo}>
              {repo}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
