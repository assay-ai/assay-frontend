/**
 * `0x…` hex ⇄ bytes.
 *
 * The EVM half of `libs/chains/solana/base64.ts`, and here for the same
 * reason: the signing port speaks `Uint8Array` on both chains so no call site
 * has to know which namespace it is on, while Privy's EVM hooks speak `0x`
 * strings. Somebody has to convert, once.
 *
 * **No viem here.** These helpers predate the viem dependency: every EVM
 * capability they serve is covered by `@privy-io/react-auth`'s own hooks, and
 * pulling in a package for `hexToBytes` would have put a chain SDK in the
 * bundle for six lines. viem now lives under this directory and may replace
 * this file with its equivalent.
 *
 * Throws on anything that is not an even-length `0x` hex string rather than
 * returning a shorter array. A signature silently truncated by one nibble is
 * a signature that verifies against nobody, and the failure surfaces on chain.
 */
const HEX_BYTE = /^[0-9a-fA-F]{2}$/;

export function hexToBytes(hex: string): Uint8Array {
  if (!hex.startsWith("0x")) {
    throw new Error(`Expected a 0x-prefixed hex string, got ${JSON.stringify(hex)}.`);
  }
  const body = hex.slice(2);
  if (body.length % 2 !== 0) {
    throw new Error(`Hex string has an odd number of digits: ${JSON.stringify(hex)}.`);
  }
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const pair = body.slice(i * 2, i * 2 + 2);
    if (!HEX_BYTE.test(pair)) {
      throw new Error(`Not hex at byte ${i} of ${JSON.stringify(hex)}: ${JSON.stringify(pair)}.`);
    }
    bytes[i] = Number.parseInt(pair, 16);
  }
  return bytes;
}
