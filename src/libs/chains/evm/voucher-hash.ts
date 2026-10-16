import { keccak256, stringToBytes } from "viem";

/**
 * The `resourceHash` an EVM voucher signs: keccak256 of the resource STRING
 * (`stringToBytes`, never `toBytes`, which would hex-decode a resource that
 * starts with `0x`) — the same as assay-backend's EVM adapter.
 */
export function voucherResourceHash(resource: string): `0x${string}` {
  return keccak256(stringToBytes(resource));
}
