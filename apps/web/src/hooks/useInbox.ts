import { useAtomValue } from "@effect/atom-react";
import { answerOf } from "../lib/answer.ts";
import { inboxAtom } from "../state/inbox.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRange } from "./useRange.ts";

// The active environment's inbox over the page's range. `isError` is true once asking has failed
// twice in a row, or its server doesn't know the inbox.
export function useInbox() {
  const { days } = useRange();
  const environmentId = useActiveEnvironment().environment?.environmentId ?? "";
  return answerOf(useAtomValue(inboxAtom({ environmentId, days })));
}
