import { useState } from "react";
import type { useThread } from "../../hooks/useThread.ts";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog.tsx";

type Thread = ReturnType<typeof useThread>;

// Deleting a thread can't be undone, so it asks first and says what goes. Not while the agent
// works or a container runs, which the server refuses too.
export function DeleteThread({ thread }: { thread: Thread }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    if (await thread.remove()) setOpen(false);
    setDeleting(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
      <Button variant="link" size="xs" disabled={thread.view.running || thread.reproduce.running} onClick={() => setOpen(true)}>
        Delete thread
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Delete this thread?</DialogTitle>
          <DialogDescription>Its messages and the files attached to them are removed from the server. This can't be undone. Changes the agent proposed stay in Settings, Changes.</DialogDescription>
        </DialogHeader>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="ghost" size="sm" disabled={deleting} />}>Cancel</DialogClose>
          <Button variant="destructive" size="sm" disabled={deleting} onClick={() => void confirm()}>
            {deleting ? "Deleting" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
