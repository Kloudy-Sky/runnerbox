import { useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useRange } from "../hooks/useRange.ts";
import { isRange, RANGES } from "../lib/range.ts";
import type { RootSearch } from "../lib/search.ts";
import { Button } from "./ui/button.tsx";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu.tsx";
import { RANGE_WORDS } from "./rangeWords.ts";

// The range a page counts over, kept in the URL, so it carries from page to page. In the bar of each
// page that reads one, as a menu like the filters beside it.
export function RangeMenu() {
  const { range } = useRange();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="compact" />}>
        {RANGE_WORDS[range].now}
        <ChevronDown className="text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-36">
        <MenuRadioGroup value={range} onValueChange={(value) => isRange(value) && void navigate({ to: ".", search: (previous: RootSearch) => ({ ...previous, range: value }) })}>
          {Object.keys(RANGES).filter(isRange).map((option) => (
            <MenuRadioItem key={option} value={option} closeOnClick>
              {RANGE_WORDS[option].now}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
