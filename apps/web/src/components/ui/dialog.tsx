import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import { cn } from "../../lib/utils.ts";

// Ported from T3 Code (MIT). The backdrop fades and the popup scales in, then both hold still. No
// blur behind it, since a blur repaints whatever moves underneath.
export const DIALOG_BACKDROP_CLASS = "fixed inset-0 z-50 bg-black/60 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0";
export const DIALOG_POPUP_CLASS =
  "relative flex min-h-0 w-full flex-col rounded-xl bg-popover text-foreground shadow-2xl shadow-black/60 outline-none transition-[scale,opacity] duration-200 ease-in-out data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0";

const Dialog = DialogPrimitive.Root;

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPopup({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className={DIALOG_BACKDROP_CLASS} data-slot="dialog-backdrop" />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 grid place-items-center p-4">
        <DialogPrimitive.Popup className={cn(DIALOG_POPUP_CLASS, "max-w-md gap-3 p-5", className)} data-slot="dialog-popup" {...props} />
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("text-base font-medium", className)} data-slot="dialog-title" {...props} />;
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("text-muted-foreground", className)} data-slot="dialog-description" {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 flex justify-end gap-2", className)} data-slot="dialog-footer" {...props} />;
}

const DialogClose = DialogPrimitive.Close;

export { Dialog, DialogClose, DialogDescription, DialogFooter, DialogPopup, DialogTitle, DialogTrigger };
