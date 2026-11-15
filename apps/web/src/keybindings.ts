// A stand-in of runnerbox's, not T3 Code's file: the shortcut checks the copied composer makes. Runnerbox has no
// keybindings config, so no command is bound; the formatting keys are T3 Code's own rule.
import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";

export interface ShortcutEventLike {
  readonly key: string;
  readonly code?: string | undefined;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly type?: string | undefined;
  readonly target?: EventTarget | null;
}

export const resolveShortcutCommand = (_event: ShortcutEventLike, _keybindings: ResolvedKeybindingsConfig, _options?: unknown): string | null => null;

export const isThreadNavigationShortcut = (_event: ShortcutEventLike, _keybindings: ResolvedKeybindingsConfig, _options?: unknown) => false;

// Bold, italic and code, with Cmd on a Mac and Ctrl elsewhere, as T3 Code binds them.
export function isRichTextFormattingShortcut(event: ShortcutEventLike): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  const key = event.key.toLowerCase();
  return key === "b" || key === "i" || key === "e" || event.code === "KeyB" || event.code === "KeyI" || event.code === "KeyE";
}
