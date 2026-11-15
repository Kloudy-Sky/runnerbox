import { useQuery } from "@tanstack/react-query";
import * as Stream from "effect/Stream";
import { attachmentPreviews } from "../lib/attachmentPreviews.ts";
import { dataUrlOf } from "../lib/dataUrl.ts";
import { runtime } from "../runtime.ts";

const bytesOf = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

// A sent image's picture: the one this window attached, or the bytes fetched back from the server in
// chunks, once, as a `data:` URL. The type is the one the server read from the bytes.
export function useSentImage(environmentId: string, threadId: string, id: string, mimeType: string) {
  const local = attachmentPreviews.get(id);
  const fetched = useQuery({
    queryKey: [environmentId, "threads.attachment", threadId, id],
    queryFn: async () => {
      const chunks = await runtime.run(environmentId, (client) => Stream.runCollect(client["threads.attachment"]({ threadId, id })));
      return dataUrlOf(new Blob([...chunks].map(bytesOf), { type: mimeType }));
    },
    enabled: local === undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return local ?? fetched.data ?? null;
}
