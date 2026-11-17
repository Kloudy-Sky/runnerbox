import { useState } from "react";
import { pickSnoozePreset, resolveSnoozePresets } from "../../lib/snoozePresets.ts";
import { Button } from "../ui/button.tsx";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu.tsx";
import { toastManager } from "../ui/toast.tsx";
import { requestCustomSnooze } from "./CustomSnoozeDialog.tsx";

// The Snooze button's menu, after T3 Code's thread row and Sidebar.snooze: its presets, soonest
// first, read fresh each time it opens, then Custom. A set time that passed while the menu was
// open is refused rather than snoozed into the past.
export function SnoozeMenu({ onSnooze }: { onSnooze: (snoozedUntil: string) => void }) {
  const [open, setOpen] = useState(false);
  const presets = open ? resolveSnoozePresets(new Date()) : [];
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger render={<Button variant="ghost-muted" size="sm" />}>Snooze</MenuTrigger>
      <MenuPopup side="bottom" align="start">
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={() => {
              const picked = pickSnoozePreset({ shown: presets, id: preset.id, now: new Date() });
              if (picked) onSnooze(picked.snoozedUntil);
              else toastManager.add({ type: "warning", title: "Couldn't snooze", description: "That time has passed. Choose another." });
            }}
          >
            {preset.label}
            <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
          </MenuItem>
        ))}
        {presets.length > 0 ? <MenuSeparator /> : null}
        <MenuItem
          onClick={async () => {
            const choice = await requestCustomSnooze();
            if (choice) onSnooze(choice.snoozedUntil);
          }}
        >
          Custom…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
