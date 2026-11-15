// A stand-in of runnerbox's, not T3 Code's file: the file icons the copied composer gives a path mention. Runnerbox
// has no working tree, so a mention gets the plain chip.
export const documentChipKindForFileName = (_fileName: string): undefined => undefined;

export function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf("/");
  return slashIndex === -1 ? pathValue : pathValue.slice(slashIndex + 1);
}
