import { getAddress, stringToHex } from "viem";

import type { Eip1193Like } from "./injected-send";

/**
 * The two EVM pieces of the operator console's wallet sign-in and directory.
 *
 * Here because `src/libs/chains/` is the only place a chain SDK may be
 * imported (`eslint.config.mjs`, `x402/chain-sdk-boundary`).
 */

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

export type AddressCheck =
  | { readonly ok: true; readonly checksummed: `0x${string}` }
  | { readonly ok: false; readonly error: string };

/**
 * An EVM address, checked against EIP-55.
 *
 * All lower-case (or all upper-case) hex carries no checksum and is accepted
 * as written; mixed case IS a checksum, and one that does not match is
 * refused — it is the sign of a mistyped character.
 */
export function checkEvmAddress(input: string): AddressCheck {
  const value = input.trim();
  if (!ADDRESS_SHAPE.test(value)) {
    return { ok: false, error: "An EVM address is 0x followed by 40 hex characters." };
  }
  const checksummed = getAddress(value.toLowerCase());
  const body = value.slice(2);
  const unchecked = body === body.toLowerCase() || body === body.toUpperCase();
  if (!unchecked && value !== checksummed) {
    return {
      ok: false,
      error: "The capital letters do not match the address checksum (EIP-55). Check for a mistyped character.",
    };
  }
  return { ok: true, checksummed };
}

/** `0xabc…` → `0xAbC…`. Returns the input unchanged when it is not an address. */
export function toChecksumAddress(address: string): string {
  return ADDRESS_SHAPE.test(address) ? getAddress(address.toLowerCase()) : address;
}

/**
 * `personal_sign` the message EXACTLY as given, through any EIP-1193 provider
 * (an injected wallet such as MetaMask, a hardware wallet behind one, or the
 * Privy embedded wallet's provider).
 *
 * The message goes over as the hex of its UTF-8 bytes, the form every wallet
 * accepts; the wallet shows the decoded text and signs the EIP-191 prefix over
 * the same bytes the backend verifies. Nothing is trimmed or re-wrapped.
 */
export async function personalSign(
  provider: Eip1193Like,
  address: string,
  message: string,
): Promise<`0x${string}`> {
  const signature = await provider.request({
    method: "personal_sign",
    params: [stringToHex(message), address],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error(`The wallet answered personal_sign with something that is not a signature (${JSON.stringify(signature)}).`);
  }
  return signature as `0x${string}`;
}
