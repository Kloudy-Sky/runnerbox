import type { TokenCipher } from "./catalog.ts";

export class KeychainUnavailable extends Error {
  constructor() {
    super("The system keychain isn't available, so runnerbox won't save this sign-in: it would be stored unencrypted. Set up a keychain (on Linux, GNOME Keyring or KWallet) and try again.");
  }
}

// Encrypts a secret for disk with the OS keychain, or refuses: a token or sign-in is never written
// in the clear.
export function sealSecret(cipher: TokenCipher, secret: string) {
  if (!cipher.available()) throw new KeychainUnavailable();
  return cipher.encrypt(secret);
}
