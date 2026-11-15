import type { Attachment } from "@runnerbox/contracts";
import { FileTextIcon } from "lucide-react";
import { useSentImage } from "../../hooks/useSentImage.ts";
import { formatBytes } from "../../lib/format.ts";
import { imagesFirst } from "../../lib/imagesFirst.ts";

// The files sent with a question, under it: each image as a picture, then each text file by name.
export function SentAttachments({ environmentId, threadId, attachments }: { environmentId: string; threadId: string; attachments: ReadonlyArray<Attachment> }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-end gap-2">
      {imagesFirst(attachments).map((attachment) =>
        attachment.kind === "image" ? (
          <SentImage key={attachment.id} environmentId={environmentId} threadId={threadId} attachment={attachment} />
        ) : (
          <span key={attachment.id} className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs">
            <FileTextIcon className="size-3.5 text-muted-foreground" />
            {attachment.name}
            <span className="text-muted-foreground">{formatBytes(attachment.size)}</span>
          </span>
        ),
      )}
    </div>
  );
}

function SentImage({ environmentId, threadId, attachment }: { environmentId: string; threadId: string; attachment: Attachment }) {
  const src = useSentImage(environmentId, threadId, attachment.id, attachment.mimeType);
  return src !== null ? (
    <img src={src} alt={attachment.name} title={attachment.name} className="max-h-48 max-w-64 rounded-md object-contain" />
  ) : (
    <span className="flex h-24 w-32 items-center justify-center rounded-md bg-muted/60 px-2 text-center text-xs text-muted-foreground">{attachment.name}</span>
  );
}
