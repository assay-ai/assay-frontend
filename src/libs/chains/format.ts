import { addressStyleOf } from "./registry";

/** Characters kept at each end of a base58 address. */
const BASE58_EDGE = 4;
/** Characters kept after `0x`, and at the end, of a hex address. */
const HEX_EDGE = 4;
const HEX_PREFIX = "0x";

/**
 * `7xKX…gAsU` on base58, `0x83ab…2913` on `eip155`.
 *
 * The chain id is **required**, and that is the whole change from the
 * `shortAddress(address)` this replaces. Four-and-four on a hex address gives
 * `0x83…2913`, which throws away two of the four characters that distinguish
 * one address from another — because two of the four it keeps are the `0x`
 * every address on the chain shares.
 *
 * An address too short to shorten is returned unchanged rather than turned
 * into an ellipsis longer than its input.
 */
export function shortAddress(chainId: string, address: string): string {
  if (addressStyleOf(chainId) === "hex") {
    const body = address.startsWith(HEX_PREFIX) ? address.slice(HEX_PREFIX.length) : address;
    if (body.length <= HEX_EDGE * 2) return address;
    return `${HEX_PREFIX}${body.slice(0, HEX_EDGE)}…${body.slice(-HEX_EDGE)}`;
  }
  if (address.length <= BASE58_EDGE * 2) return address;
  return `${address.slice(0, BASE58_EDGE)}…${address.slice(-BASE58_EDGE)}`;
}
