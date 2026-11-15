import { FileTextIcon, ImageIcon, XIcon } from "lucide-react";
import type { StagedFile } from "../../composerDraftStore.ts";
import type { Uploading } from "../../hooks/useComposerAttachments.ts";
import { attachmentPreviews } from "../../lib/attachmentPreviews.ts";
import { formatBytes } from "../../lib/format.ts";
import { imagesFirst } from "../../lib/imagesFirst.ts";

// The files attached to the draft, above the editor: a picture or a file icon, the name and size,
// and a way to take each off. One still uploading says how far it has got, without moving parts.
export function AttachmentStrip({ staged, uploading, onRemove }: { staged: ReadonlyArray<StagedFile>; uploading: ReadonlyArray<Uploading>; onRemove: (id: string) => void }) {
  if (staged.length === 0 && uploading.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 pb-2" aria-label="Attached files">
      {imagesFirst(staged).map((file) => (
        <Chip key={file.id} name={file.name} detail={formatBytes(file.size)} kind={file.kind} preview={attachmentPreviews.get(file.id) ?? null} onRemove={() => onRemove(file.id)} />
      ))}
      {uploading.map((file) => (
        <Chip key={file.localId} name={file.name} detail={`uploading, ${Math.floor((file.sent / file.size) * 100)}%`} kind={file.kind} preview={file.preview} onRemove={null} />
      ))}
    </ul>
  );
}

function Chip(props: { name: string; detail: string; kind: StagedFile["kind"]; preview: string | null; onRemove: (() => void) | null }) {
  return (
    <li className="flex max-w-64 items-center gap-2 rounded-md bg-muted/60 py-1 pr-1 pl-1 text-xs">
      {props.preview !== null ? (
        <img src={props.preview} alt="" className="size-8 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-background/60 text-muted-foreground">
          {props.kind === "image" ? <ImageIcon className="size-4" /> : <FileTextIcon className="size-4" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{props.name}</span>
        <span className="block text-muted-foreground">{props.detail}</span>
      </span>
      {props.onRemove !== null ? (
        <button type="button" onClick={props.onRemove} aria-label={`Remove ${props.name}`} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <XIcon className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}
