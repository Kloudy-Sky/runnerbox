import type { ThreadSubject } from "@runnerbox/contracts";
import type { ReactNode } from "react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { useComposerAttachments } from "../hooks/useComposerAttachments.ts";
import { useRange } from "../hooks/useRange.ts";
import { useServerCapabilities } from "../hooks/useServerCapabilities.ts";
import { useThread } from "../hooks/useThread.ts";
import { Composer } from "./thread/Composer.tsx";
import { ThreadMessages } from "./thread/ThreadMessages.tsx";

type Thread = ReturnType<typeof useThread>;

// A subject's reading column with its agent thread under it and one composer at the bottom, as in
// T3 Code's chat column. `children` gets the thread, so its primary action can start a turn. Files
// dragged anywhere over the column are attached to the composer's draft, on a server that takes them.
export function ThreadColumn(props: { subject: ThreadSubject; placeholder: string; children: (thread: Thread) => ReactNode }) {
  const { days } = useRange();
  const thread = useThread(props.subject, days);
  const attachments = useComposerAttachments(thread.environmentId, thread.draftKey);
  const capabilities = useServerCapabilities();
  const [dragging, setDragging] = useState(false);
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  const scroller = useRef<HTMLDivElement>(null);
  // Keeps the newest text in view as it streams, which follows something outside React's state.
  useEffect(() => {
    const element = scroller.current;
    if (element && thread.view.running) element.scrollTo({ top: element.scrollHeight });
  }, [thread.view.items.length, thread.view.partial?.text, thread.view.running]);
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col rounded-2xl", dragging && "bg-accent/45 ring-1 ring-inset ring-primary/70")}
      onDragOver={(event) => {
        if (!carriesFiles(event) || !thread.permitted || !capabilities.attachments) return;
        event.preventDefault();
        setDragging(true);
      }}
      // Leaving for a child isn't leaving the column.
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event) || !capabilities.attachments) return;
        event.preventDefault();
        setDragging(false);
        attachments.add([...event.dataTransfer.files]);
      }}
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {props.children(thread)}
        <div className="mx-auto w-full max-w-(--reading-width) px-6 pb-6">
          <ThreadMessages view={thread.view} error={thread.error} environmentId={thread.environmentId} onCancelQueued={thread.cancelQueued} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-(--reading-width) px-6 pt-2 pb-4">
        <Composer thread={thread} attachments={attachments} capabilities={capabilities} placeholder={props.placeholder} />
      </div>
    </div>
  );
}
