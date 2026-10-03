/**
 * Base64 ⇄ bytes, both directions, in one file.
 *
 * The two halves used to live apart — `toBase64` in `deposit-transaction.ts`
 * (which sends bytes *up*) and `base64ToBytes` in
 * `features/provider-stake/run-stake-intent.ts` (which brought them *down*) —
 * and they are exact inverses whose correctness argument is the same
 * paragraph. `useSigner`'s Solana branch now does both, so keeping them apart
 * would have meant a third copy or an import that drags a transaction builder
 * into the app shell.
 *
 * **`atob`/`btoa` and a charCode loop, never `TextEncoder`/`TextDecoder`.**
 * This runs in the browser and it is byte-exact. `TextEncoder` re-encodes
 * anything above `0x7f` as UTF-8 and silently lengthens a transaction the
 * wallet then cannot parse — a failure that looks like a malformed transaction
 * rather than like an encoding bug.
 *
 * **Not in `libs/chains/solana` because base64 is a Solana idea.** It is here
 * because the only wire shape in this app that carries base64 bytes is the
 * `solana` member of `UnsignedChainTransaction`; the `eip155` members carry
 * `0x` hex and never come through this file.
 *
 * This module imports no chain SDK, deliberately: `useSigner` is reachable
 * from the app shell (the wallet menu is on every screen), and importing the
 * codec from `deposit-transaction.ts` would put `@solana/kit` and three
 * `@solana-program/*` packages on that path for the sake of six lines.
 */

/** x402's `payload.transaction` is base64; a wallet returns `Uint8Array`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** The exact inverse of `toBase64`. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
