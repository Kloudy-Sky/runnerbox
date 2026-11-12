import { useState } from "react";
import type { useThread } from "../../hooks/useThread.ts";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog.tsx";
import { Switch } from "../ui/switch.tsx";

type Thread = ReturnType<typeof useThread>;

// The owner's switch for a reproduce, in the composer's footer: Reproduce asks first and says what
// the container can't do, Stop removes it. Nothing shows when the job can't be reproduced or this
// session may not start one.
export function ReproduceControl({ thread }: { thread: Thread }) {
  const { check, running, start, stop } = thread.reproduce;
  const [open, setOpen] = useState(false);
  const [cutNetwork, setCutNetwork] = useState(false);
  const [starting, setStarting] = useState(false);
  if (running) {
    return (
      <Button variant="link" size="xs" onClick={stop}>
        Stop container
      </Button>
    );
  }
  if (check?._tag !== "Ready") return null;
  const confirm = async () => {
    setStarting(true);
    const started = await start(cutNetwork ? "setup" : "on");
    setStarting(false);
    if (started) setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !starting && setOpen(next)}>
      <Button variant="link" size="xs" disabled={thread.view.running} onClick={() => setOpen(true)}>
        Reproduce
      </Button>
      <DialogPopup>
        <DialogTitle>Rerun this job in a container?</DialogTitle>
        <DialogDescription>
          A throwaway container on {check.kind}'s {check.imageRecorded ? "image the job ran on" : "current image, since the job's own wasn't recorded"}, with commit {check.commit.slice(0, 7)}'s
          files. The agent can run commands in it until you stop it, for up to 30 minutes.
        </DialogDescription>
        <p className="text-muted-foreground">It isn't a runner: no marketplace actions, no job secrets, no service containers. It makes way for real jobs that need the memory.</p>
        <label className="flex items-center justify-between gap-3 py-1">
          <span>Cut the network after the first command</span>
          <Switch checked={cutNetwork} onCheckedChange={setCutNetwork} />
        </label>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" size="sm" disabled={starting} />}>Cancel</DialogClose>
          <Button size="sm" disabled={starting} onClick={() => void confirm()}>
            {starting ? "Starting" : "Start"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
