import { ed25519 } from "@noble/curves/ed25519.js";
import { serverProofMessage } from "@runnerbox/contracts";

// Checks a server's signature over this client's nonce. Pure JS, since the desktop renderer and a
// browser on a plain-HTTP address have no WebCrypto.

// An Ed25519 SPKI is this fixed DER header followed by the 32-byte key.
const SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);

const base64Bytes = (text: string) => {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const rawPublicKey = (pem: string) => {
  const der = base64Bytes(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, ""));
  const matches = der.length === SPKI_PREFIX.length + 32 && SPKI_PREFIX.every((byte, index) => der[index] === byte);
  return matches ? der.slice(SPKI_PREFIX.length) : null;
};

export const newServerNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");

export function verifyServerProof(input: { publicKey: string; environmentId: string; nonce: string; proof: string }) {
  try {
    const key = rawPublicKey(input.publicKey);
    if (!key) return false;
    return ed25519.verify(base64Bytes(input.proof), new TextEncoder().encode(serverProofMessage(input.environmentId, input.nonce)), key, { zip215: false });
  } catch {
    return false;
  }
}
