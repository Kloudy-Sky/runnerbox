import type { ThreadSubject } from "@runnerbox/contracts";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useRange } from "../hooks/useRange.ts";
import { useThread } from "../hooks/useThread.ts";
import { Composer } from "./thread/Composer.tsx";
import { ThreadMessages } from "./thread/ThreadMessages.tsx";

type Thread = ReturnType<typeof useThread>;

// A subject's reading column with its agent thread under it and one composer at the bottom, as in
// T3 Code's chat column. `children` gets the thread, so its primary action can start a turn.
export function ThreadColumn(props: { subject: ThreadSubject; placeholder: string; children: (thread: Thread) => ReactNode }) {
  const { days } = useRange();
  const thread = useThread(props.subject, days);
  const scroller = useRef<HTMLDivElement>(null);
  // Keeps the newest text in view as it streams, which follows something outside React's state.
  useEffect(() => {
    const element = scroller.current;
    if (element && thread.view.running) element.scrollTo({ top: element.scrollHeight });
  }, [thread.view.items.length, thread.view.partial?.text, thread.view.running]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {props.children(thread)}
        <div className="mx-auto w-full max-w-(--reading-width) px-6 pb-6">
          <ThreadMessages view={thread.view} error={thread.error} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-(--reading-width) px-6 pt-2 pb-4">
        <Composer thread={thread} placeholder={props.placeholder} />
      </div>
    </div>
  );
}
