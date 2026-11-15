// A file or bytes as a `data:` URL, the one kind of image source besides the app itself that its
// Content-Security-Policy allows.
export const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
