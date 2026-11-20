import { useAtomSet } from "@effect/atom-react";
import { commandPaletteOpenAtom } from "../state/commandPalette.ts";
import { Button } from "./ui/button.tsx";
import { Kbd } from "./ui/kbd.tsx";

// What ends every page's bar: opens the command palette, for anyone who doesn't know ⌘K. A phone
// has no ⌘K and no room for it beside the page's controls, so it's left off there.
export function PaletteButton() {
  const setOpen = useAtomSet(commandPaletteOpenAtom);
  return (
    <Button variant="ghost-muted" size="xs" className="shrink-0 max-sm:hidden" onClick={() => setOpen(true)} aria-label="Jump to a page, item or run" title="Jump to a page, item or run">
      <Kbd>⌘K</Kbd>
    </Button>
  );
}
