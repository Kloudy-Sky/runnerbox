import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { inboxAtom } from "../state/inbox.ts";
import { useActiveEnvironment } from "./useEnvironment.ts";
import { useRange } from "./useRange.ts";

// The active environment's inbox over the page's range. `isError` is true once its server has
// refused, as one older than the inbox does.
export function useInbox() {
  const { days } = useRange();
  const environmentId = useActiveEnvironment().environment?.environmentId ?? "";
  const inbox = useAtomValue(inboxAtom({ environmentId, days }));
  return { data: Option.getOrUndefined(AsyncResult.value(inbox)), isError: AsyncResult.isFailure(inbox) };
}
