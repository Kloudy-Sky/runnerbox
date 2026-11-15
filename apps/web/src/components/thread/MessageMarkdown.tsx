import Markdown from "react-markdown";
import { cn } from "~/lib/utils";
import { markdownOptions } from "./markdownPolicy.ts";

// A message in the thread, the owner's or the agent's, as Markdown, styled like T3 Code's chat.
export function MessageMarkdown({ text, from }: { text: string; from: "owner" | "agent" }) {
  return (
    <div className={cn("chat-markdown", from === "owner" && "user-message-markdown")}>
      <Markdown {...markdownOptions}>{text}</Markdown>
    </div>
  );
}
