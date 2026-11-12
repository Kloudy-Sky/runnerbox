import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Search } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";
import { DIALOG_BACKDROP_CLASS, DIALOG_POPUP_CLASS } from "./dialog.tsx";

// Ported from T3 Code (MIT): a dialog around an always-open autocomplete. Type to filter, arrow
// keys to move, Enter to choose.
const CommandDialog = DialogPrimitive.Root;

function CommandDialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className={DIALOG_BACKDROP_CLASS} data-slot="command-dialog-backdrop" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex flex-col items-center px-4 pt-[12vh]">
        <DialogPrimitive.Popup className={cn(DIALOG_POPUP_CLASS, "max-h-[60vh] max-w-xl overflow-hidden", className)} data-slot="command-dialog-popup" {...props} />
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function Command(props: React.ComponentProps<typeof Autocomplete.Root>) {
  return <Autocomplete.Root open inline autoHighlight="always" keepHighlight {...props} />;
}

function CommandInput({ className, ...props }: Autocomplete.Input.Props) {
  return (
    <div className="flex items-center gap-2 px-3">
      <Search className="size-4 text-muted-foreground" />
      <Autocomplete.Input className={cn("h-11 w-full bg-transparent outline-none placeholder:text-placeholder", className)} data-slot="command-input" {...props} />
    </div>
  );
}

function CommandList({ className, ...props }: Autocomplete.List.Props) {
  return <Autocomplete.List className={cn("min-h-0 overflow-y-auto p-1.5 empty:p-0", className)} data-slot="command-list" {...props} />;
}

function CommandGroup(props: Autocomplete.Group.Props) {
  return <Autocomplete.Group data-slot="command-group" {...props} />;
}

function CommandGroupLabel({ className, ...props }: Autocomplete.GroupLabel.Props) {
  return <Autocomplete.GroupLabel className={cn("px-2 pt-2 pb-1 text-muted-foreground text-xs", className)} data-slot="command-group-label" {...props} />;
}

const CommandCollection = Autocomplete.Collection;

function CommandItem({ className, ...props }: Autocomplete.Item.Props) {
  return (
    <Autocomplete.Item
      className={cn("flex min-h-8 cursor-default select-none items-center gap-2 rounded-md px-2 py-1 outline-none data-highlighted:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground", className)}
      data-slot="command-item"
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof Autocomplete.Empty>) {
  return <Autocomplete.Empty className={cn("px-3 py-6 text-center text-muted-foreground empty:hidden", className)} data-slot="command-empty" {...props} />;
}

export { Command, CommandCollection, CommandDialog, CommandDialogPopup, CommandEmpty, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList };
