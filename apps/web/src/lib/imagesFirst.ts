// Files in the order people see them everywhere: images, then text files, each in the order added.
// Uploads finish in any order, so the order they reached the server isn't one to show.
export const imagesFirst = <A extends { readonly kind: "image" | "text" }>(files: ReadonlyArray<A>) =>
  files.filter((file) => file.kind === "image").concat(files.filter((file) => file.kind === "text"));
