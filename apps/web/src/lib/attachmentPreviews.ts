// Pictures of images this window attached, as `data:` URLs by attachment ID, so the composer and
// then the sent message show them without fetching them back. Lost on reload, when the thread
// fetches them instead.
const previews = new Map<string, string>();

export const attachmentPreviews = {
  get: (id: string) => previews.get(id),
  set: (id: string, url: string) => void previews.set(id, url),
  forget: (id: string) => void previews.delete(id),
};
