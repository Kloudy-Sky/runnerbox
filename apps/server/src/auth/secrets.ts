import { createHash, randomBytes, randomInt } from "node:crypto";

const BASE32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export const newToken = () => `rbx_${randomBytes(32).toString("base64url")}`;
export const newId = () => randomBytes(8).toString("hex");

// 20 characters from 32 symbols is 100 bits, so a code can't be guessed in the minutes it lives.
// Grouped for reading aloud or typing; `normalizeCode` undoes the grouping and case.
export const newPairingCode = () => {
  const symbols = Array.from({ length: 20 }, () => BASE32[randomInt(BASE32.length)]).join("");
  return symbols.match(/.{5}/g)!.join("-");
};

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
