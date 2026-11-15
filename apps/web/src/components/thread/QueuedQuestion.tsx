import type { QueuedMessage } from "@runnerbox/contracts";
import { Button } from "../ui/button.tsx";
import { MessageMarkdown } from "./MessageMarkdown.tsx";

// The question waiting for the agent to finish, at the end of the thread: dashed and unfilled, as
// T3 Code marks a message not sent yet. Cancel brings it back to the composer.
export function QueuedQuestion({ queued, onCancel }: { queued: QueuedMessage; onCancel: () => void }) {
  return (
    <div className="enter" aria-label="Waiting question, not sent">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span>You, waiting for the agent to finish</span>
        <Button variant="link" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div className="mt-1 rounded-2xl border border-muted-foreground/40 border-dashed px-3 py-2 text-muted-foreground">
        <MessageMarkdown text={queued.text} from="owner" />
      </div>
    </div>
  );
}
