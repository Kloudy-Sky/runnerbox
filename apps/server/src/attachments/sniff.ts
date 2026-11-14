import { ATTACHMENT_LIMITS, type AttachmentKind, type AttachmentMime } from "@runnerbox/contracts";

const startsWith = (bytes: Uint8Array, prefix: ReadonlyArray<number>, at = 0) => prefix.every((byte, index) => bytes[at + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// The image formats Claude accepts, by their magic numbers.
const IMAGES: ReadonlyArray<{ readonly mimeType: AttachmentMime; readonly matches: (bytes: Uint8Array) => boolean }> = [
  { mimeType: "image/png", matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: "image/jpeg", matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]) },
  { mimeType: "image/gif", matches: (bytes) => startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a")) },
  { mimeType: "image/webp", matches: (bytes) => startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8) },
];

const utf8 = new TextDecoder("utf-8", { fatal: true });
const isText = (bytes: Uint8Array) => {
  if (bytes.length > ATTACHMENT_LIMITS.textBytes || bytes.includes(0)) return false;
  try {
    utf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
};

// What a staged file is, from its bytes alone. Null is anything else, which is refused.
export function sniff(bytes: Uint8Array): { readonly kind: AttachmentKind; readonly mimeType: AttachmentMime } | null {
  const image = IMAGES.find((candidate) => candidate.matches(bytes));
  if (image) return { kind: "image", mimeType: image.mimeType };
  return isText(bytes) ? { kind: "text", mimeType: "text/plain" } : null;
}
