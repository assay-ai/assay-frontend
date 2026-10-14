import { getAddress, isAddress } from "viem";

/** A 0x-prefixed hex string, without importing viem outside `src/libs/chains/`. */
export type HexString = `0x${string}`;

/**
 * A typed or pasted EVM address → its checksummed form, or `null` when it is
 * not one. Case is not checked: a provider pasting an all-lower-case address
 * from an explorer is not making a mistake.
 */
export function normaliseEvmAddress(input: string): HexString | null {
  const trimmed = input.trim();
  return isAddress(trimmed, { strict: false }) ? getAddress(trimmed) : null;
}
