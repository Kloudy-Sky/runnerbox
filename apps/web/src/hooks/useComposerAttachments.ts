import { ATTACHMENT_LIMITS, type AttachmentKind } from "@runnerbox/contracts";
import { useState } from "react";
import { type StagedFile, useComposerDraftStore } from "../composerDraftStore.ts";
import { attachmentPreviews } from "../lib/attachmentPreviews.ts";
import { precheck } from "../lib/attachmentIntake.ts";
import { dataUrlOf } from "../lib/dataUrl.ts";
import { runtime } from "../runtime.ts";

// A file on its way to the server: how much of it has gone, and its picture if it's an image.
export type Uploading = { readonly localId: string; readonly name: string; readonly size: number; readonly kind: AttachmentKind; readonly sent: number; readonly preview: string | null };

const NONE: ReadonlyArray<StagedFile> = [];
const errorText = (error: unknown) => (error instanceof Error ? error.message : "That didn't work.");

const base64Of = async (blob: Blob) => {
  const url = await dataUrlOf(blob);
  return url.slice(url.indexOf(",") + 1);
};

// The files attached to one draft: staged on the server in chunks as they're added, so sending only
// names them. A refusal, from here or the server, is one plain line, kept until the next file.
export function useComposerAttachments(environmentId: string, draftKey: string) {
  const staged = useComposerDraftStore((store) => store.drafts[draftKey]?.attachments ?? NONE);
  const addAttachment = useComposerDraftStore((store) => store.addAttachment);
  const removeAttachment = useComposerDraftStore((store) => store.removeAttachment);
  const [uploading, setUploading] = useState<ReadonlyArray<Uploading>>([]);
  const [refusal, setRefusal] = useState<string | null>(null);

  const upload = async (file: File, kind: AttachmentKind) => {
    const localId = crypto.randomUUID();
    const patch = (change: Partial<Uploading>) => setUploading((all) => all.map((each) => (each.localId === localId ? { ...each, ...change } : each)));
    // Counted as uploading from the start, so Send waits and the count holds while the picture is read.
    setUploading((all) => [...all, { localId, name: file.name, size: file.size, kind, sent: 0, preview: null }]);
    const preview = kind === "image" ? await dataUrlOf(file).catch(() => null) : null;
    patch({ preview });
    try {
      const { id } = await runtime.run(environmentId, (client) => client["threads.stageAttachment"]({ name: file.name.slice(0, 200) || "file", size: file.size }));
      for (let offset = 0; offset < file.size; offset += ATTACHMENT_LIMITS.chunkBytes) {
        const data = await base64Of(file.slice(offset, offset + ATTACHMENT_LIMITS.chunkBytes));
        const { received, attachment } = await runtime.run(environmentId, (client) => client["threads.attachmentChunk"]({ id, offset, data }));
        patch({ sent: received });
        if (attachment !== null) {
          if (preview !== null) attachmentPreviews.set(attachment.id, preview);
          addAttachment(draftKey, { id: attachment.id, name: attachment.name, size: attachment.size, kind: attachment.kind, at: Date.now() });
        }
      }
    } catch (error) {
      setRefusal(`${file.name}: ${errorText(error)}`);
    } finally {
      setUploading((all) => all.filter((each) => each.localId !== localId));
    }
  };

  const add = (files: ReadonlyArray<File>) => {
    setRefusal(null);
    let count = staged.length + uploading.length;
    for (const file of files) {
      const checked = precheck(file, count);
      if ("refusal" in checked) {
        setRefusal(`${file.name}: ${checked.refusal}`);
        continue;
      }
      count += 1;
      void upload(file, checked.kind);
    }
  };

  // Dropped from the draft and from the server; a failure there only leaves it to expire.
  const remove = (id: string) => {
    removeAttachment(draftKey, id);
    attachmentPreviews.forget(id);
    runtime.run(environmentId, (client) => client["threads.discardAttachment"]({ id })).catch(() => {});
  };

  // After a send, an old refusal is about a question that's gone.
  const settle = () => setRefusal(null);

  return { staged, uploading, refusal, add, remove, settle, busy: uploading.length > 0 };
}
