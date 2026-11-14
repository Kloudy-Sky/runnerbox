import * as Schema from "effect/Schema";

// Files the owner attaches to a question: images the agent sees, and text files inlined in the
// prompt. A file is staged in chunks first, then claimed by the turn it's sent with.
export const ATTACHMENT_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  // A text file goes into the prompt as text, so it's held to far less than an image.
  textBytes: 200 * 1024,
  perMessage: 5,
  stagedBytesPerSession: 50 * 1024 * 1024,
  // Everything under the server's attachments directory, staged or sent.
  serverBytes: 500 * 1024 * 1024,
  // One chunk per RPC call, so a big file never holds up the socket's other calls.
  chunkBytes: 512 * 1024,
} as const;

export const AttachmentId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/));
export const AttachmentName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
export const AttachmentKind = Schema.Literals(["image", "text"]);
export type AttachmentKind = typeof AttachmentKind.Type;
// The type is read from the bytes on the server, never taken from the name or the client.
export const AttachmentMime = Schema.Literals(["image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"]);
export type AttachmentMime = typeof AttachmentMime.Type;

export const Attachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: AttachmentKind,
  mimeType: AttachmentMime,
  size: Schema.Int,
});
export type Attachment = typeof Attachment.Type;

export const StageAttachment = Schema.Struct({
  name: AttachmentName,
  size: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: ATTACHMENT_LIMITS.fileBytes })),
});
// Base64 of at most one chunk. Chunks arrive in order: `offset` must be what the server has.
export const AttachmentChunk = Schema.Struct({
  id: AttachmentId,
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  data: Schema.String.check(Schema.isMaxLength(Math.ceil(ATTACHMENT_LIMITS.chunkBytes / 3) * 4), Schema.isBase64()),
});
// `attachment` is set once the last chunk is in and the type is known.
export const ChunkReceived = Schema.Struct({ received: Schema.Int, attachment: Schema.NullOr(Attachment) });

export class AttachmentError extends Schema.TaggedError<AttachmentError>()("AttachmentError", {
  reason: Schema.Literals(["too_large", "too_many", "unsupported_type", "session_full", "server_full", "not_found", "out_of_order", "unreadable"]),
}) {
  override get message() {
    switch (this.reason) {
      case "too_large":
        return "That file is too big. Images can be up to 10 MB, text files up to 200 KB.";
      case "too_many":
        return "A question can carry up to 5 files.";
      case "unsupported_type":
        return "Only PNG, JPEG, GIF and WebP images, and plain text files, can be attached.";
      case "session_full":
        return "This device has 50 MB of files waiting to be sent. Send or remove some first.";
      case "server_full":
        return "The server has no room for more attachments. Delete threads you no longer need.";
      case "not_found":
        return "That attachment isn't on the server any more. Attach it again.";
      case "out_of_order":
        return "The upload got out of step. Attach the file again.";
      case "unreadable":
        return "Couldn't read or write attachments on the server.";
    }
  }
}
