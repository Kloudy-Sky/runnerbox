import { ATTACHMENT_LIMITS, AttachmentError, type AttachmentKind } from "@runnerbox/contracts";

// The browser's own description of a picked, dropped or pasted file.
export type PickedFile = { readonly name: string; readonly size: number; readonly type: string };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
// Text that isn't typed `text/*`: config, data and logs as browsers and systems often label them.
const TEXT_TYPES = new Set(["application/json", "application/x-yaml", "application/yaml", "application/xml", "application/toml", "application/x-sh"]);

// What the composer can tell before uploading, so an obvious refusal comes at once and in the
// server's own words. The server still reads the type from the bytes and has the final say: a file
// with no type is sent as text and refused there if it isn't.
export function precheck(file: PickedFile, alreadyAttached: number): { readonly kind: AttachmentKind } | { readonly refusal: string } {
  const refuse = (reason: AttachmentError["reason"]) => ({ refusal: new AttachmentError({ reason }).message });
  if (alreadyAttached >= ATTACHMENT_LIMITS.perMessage) return refuse("too_many");
  if (IMAGE_TYPES.has(file.type)) return file.size > ATTACHMENT_LIMITS.fileBytes ? refuse("too_large") : { kind: "image" };
  const text = file.type === "" || file.type.startsWith("text/") || TEXT_TYPES.has(file.type);
  if (!text) return refuse("unsupported_type");
  if (file.size === 0) return refuse("unsupported_type");
  return file.size > ATTACHMENT_LIMITS.textBytes ? refuse("too_large") : { kind: "text" };
}
