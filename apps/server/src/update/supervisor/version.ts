// Release versions as the release workflow makes them, such as 0.3.2 or 0.3.2-nightly.20261114.41,
// compared by semver's rules. The supervisor can't load the semver package, so this is the part
// of it an update needs: an exact version, and which of two is newer.
// packages/contracts/src/update.ts has the same rule as RELEASE_VERSION.
export const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export const isExactVersion = (version: string) => version.length <= 256 && EXACT.test(version);

const NUMERIC = /^\d+$/;

// Below zero when `a` is older than `b`, above when newer. Both must be exact.
export function compareVersions(a: string, b: string): number {
  const [, ...left] = EXACT.exec(a) ?? [];
  const [, ...right] = EXACT.exec(b) ?? [];
  if (left.length === 0 || right.length === 0) throw new Error(`${a} or ${b} isn't an exact version.`);
  for (let index = 0; index < 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  const [leftPre, rightPre] = [left[3], right[3]];
  // A release sorts above any prerelease of the same version.
  if (leftPre === undefined || rightPre === undefined) return leftPre === rightPre ? 0 : leftPre === undefined ? 1 : -1;
  const [leftIds, rightIds] = [leftPre.split("."), rightPre.split(".")];
  for (let index = 0; index < Math.min(leftIds.length, rightIds.length); index++) {
    const [x, y] = [leftIds[index]!, rightIds[index]!];
    if (x === y) continue;
    const [xNumeric, yNumeric] = [NUMERIC.test(x), NUMERIC.test(y)];
    if (xNumeric && yNumeric) return Math.sign(Number(x) - Number(y));
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(leftIds.length - rightIds.length);
}
