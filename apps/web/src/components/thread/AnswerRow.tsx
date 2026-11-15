import { cn } from "~/lib/utils";
import { MessageCopyButton } from "../chat/MessageCopyButton.tsx";
import { MessageAuthorHeading } from "../chat/TimelineRowParts.tsx";
import { MessageMarkdown } from "./MessageMarkdown.tsx";
import { RowTime } from "./RowTime.tsx";

// What the agent said, as T3 Code's assistant message: full width with no bubble. A turn's last words
// have a copy button and their time under them, on hover, or always for the thread's last; words
// before them in the turn, and streaming text, have neither, and sit closer to what follows.
export function AnswerRow({ text, at, last }: { text: string; at: string | null; last: boolean }) {
  return (
    <div className={cn("group/assistant", at === null ? "pb-2" : "pb-4")} data-timeline-row-kind="answer">
      <div className="relative min-w-0 px-1 py-0.5">
        <MessageAuthorHeading>Agent</MessageAuthorHeading>
        <MessageMarkdown text={text} from="agent" />
        {at !== null ? (
          <div
            className={cn(
              "mt-1.5 flex items-center gap-2 text-xs tabular-nums transition-opacity duration-200",
              last ? "opacity-100" : "opacity-0 pointer-coarse:opacity-100 focus-within:opacity-100 group-hover/assistant:opacity-100",
            )}
          >
            <MessageCopyButton text={text} variant="ghost" />
            <RowTime at={at} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
