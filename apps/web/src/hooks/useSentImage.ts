import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { attachmentPreviews } from "../lib/attachmentPreviews.ts";
import { sentImageAtom } from "../state/threads.ts";

// A sent image's picture: the one this window attached, or the bytes fetched back from the server.
// One this window attached reads no machine, which never asks.
export function useSentImage(environmentId: string, threadId: string, id: string, mimeType: string) {
  const local = attachmentPreviews.get(id);
  const fetched = useAtomValue(sentImageAtom({ environmentId: local === undefined ? environmentId : "", threadId, id, mimeType }));
  return local ?? Option.getOrNull(AsyncResult.value(fetched));
}
