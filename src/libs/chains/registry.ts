/**
 * What a CAIP-2 chain id says about itself — and nothing else.
 *
 * There is deliberately **no table of chains here.** A
 * build-time copy of the chain list drifts from the deployment and the failure
 * is a user shown a chain the API then refuses; that argument is about drift,
 * not about lists, so it applies equally to a hardcoded display name or
 * explorer URL. Those come from `GET /chains` (`@/interfaces/chain`). What
 * lives here is the part an API cannot be wrong about because it is spelled
 * inside the id: the namespace, and how addresses on it are written.
 *
 * Nothing in this file may special-case a chain — only a namespace. The first
 * thing a hardcoded "Solana" does on an `eip155:*` row is lie about it.
 */

/** How an address on this chain is written, which decides how it is shortened. */
export type AddressStyle = "base58" | "hex";

/** The `eip155` namespace, spelled once. */
const EVM_NAMESPACE = "eip155";

/**
 * The CAIP-2 namespace, or `""` when the argument is not a CAIP-2 id.
 *
 * Empty rather than a guess, and rather than a throw. A guessed namespace
 * reaches `addressStyleOf`, and the cheapest guess to write — "solana",
 * because that is what everything used to be — renders an `0x` address two
 * characters short of distinguishing it from another. A throw would be worse
 * still on this path: these ids arrive on the wire, and a label helper is not
 * where a screen should die.
 *
 * String indexing rather than `split(":")` so that `"constructor"` and
 * `"toString"` cannot resolve through `Object.prototype` — the same defence
 * `useSigner`'s chain Map makes, for the same reason.
 */
export function namespaceOf(chainId: string): string {
  const separator = chainId.indexOf(":");
  if (separator <= 0) return "";
  const reference = chainId.slice(separator + 1);
  if (reference.length === 0) return "";
  return chainId.slice(0, separator);
}

/** Whether this chain's addresses, signatures and transactions are Ethereum-shaped. */
export function isEvmChain(chainId: string): boolean {
  return namespaceOf(chainId) === EVM_NAMESPACE;
}

/**
 * Whether a buyer's escrow exists only once they first deposit, so nothing can
 * be signed against it before that. True on Solana, where the first deposit
 * opens the escrow account. False on `eip155`: `escrows[buyer]` is there from
 * the start (all zeros), so the payer can set limits and let an agent pay
 * before depositing, and a voucher is still only ever paid from the chain
 * balance. An unknown chain keeps the stricter answer.
 */
export function firstDepositOpensEscrow(chainId: string | null | undefined): boolean {
  return !chainId || !isEvmChain(chainId);
}

/**
 * `hex` on `eip155`, `base58` everywhere else — including on an id this build
 * does not recognise.
 *
 * The fallback is `base58` because between two wrong answers, the one that
 * adds no characters is recoverable: base58 shortening of a hex string drops
 * two significant characters, while hex shortening of a base58 string invents
 * an `0x` prefix that is not in the address at all.
 */
export function addressStyleOf(chainId: string): AddressStyle {
  return isEvmChain(chainId) ? "hex" : "base58";
}
