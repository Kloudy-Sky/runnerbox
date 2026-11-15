import type { ThreadItem } from "@runnerbox/contracts";
import { MessageCopyButton } from "../chat/MessageCopyButton.tsx";
import { MessageAuthorHeading } from "../chat/TimelineRowParts.tsx";
import { MessageMarkdown } from "./MessageMarkdown.tsx";
import { RowTime } from "./RowTime.tsx";
import { SentAttachments } from "./SentAttachments.tsx";
import { SentReferences } from "./SentReferences.tsx";

// Shown on hover or focus, and always on touch, as T3 Code reveals a message's actions.
const REVEAL_ON_HOVER = "opacity-0 transition-opacity duration-200 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover:opacity-100";

// A question, as T3 Code's user message: a bubble on the right with the files sent above it, and its
// time and a copy button under it. A monitor's question says it came from the monitor.
export function QuestionRow({ item, environmentId, threadId }: { item: Extract<ThreadItem, { _tag: "UserMessage" }>; environmentId: string; threadId: string | null }) {
  const sender = item.source === "monitor" ? "Monitor" : "You";
  return (
    <div className="group flex flex-col items-end gap-1 pb-4" data-timeline-row-kind="question">
      {item.source === "monitor" ? <p className="me-1 text-2xs text-muted-foreground/70">Monitor</p> : null}
      {item.attachments && threadId !== null ? (
        <div className="flex max-w-[80%] justify-end">
          <SentAttachments environmentId={environmentId} threadId={threadId} attachments={item.attachments} />
        </div>
      ) : null}
      <div className="relative min-w-0 max-w-[80%] rounded-2xl bg-message p-3 text-message-foreground">
        <MessageAuthorHeading>{sender}</MessageAuthorHeading>
        <MessageMarkdown text={item.text} from="owner" />
        {item.references ? <SentReferences references={item.references} /> : null}
      </div>
      <div className={`flex w-full max-w-[80%] items-center justify-end gap-2 pe-1 text-xs tabular-nums ${REVEAL_ON_HOVER}`}>
        <RowTime at={item.at} />
        <MessageCopyButton text={item.text} variant="ghost" />
      </div>
    </div>
  );
}
