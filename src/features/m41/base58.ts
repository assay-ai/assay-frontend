/**
 * base58 (Bitcoin alphabet), encode only.
 *
 * `POST /providers/me/payout-address` wants the ed25519 signature as base58,
 * and an injected Solana wallet hands `signMessage` back as raw bytes. Nothing
 * in the dependency list encodes them — the app has no `bs58`, no
 * `@solana/web3.js` and no wallet adapter — so the twenty lines live here
 * rather than becoming a dependency the whole console pays for.
 *
 * Encode only, on purpose: nothing in this flow ever decodes a signature. The
 * platform does that, against the message on the stored challenge row.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Leading zero bytes are not carried by the big-integer conversion below —
  // base58 spells each one as a literal "1".
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}
