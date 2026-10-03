/**
 * CAIP-2 chain ids, made readable, in one place.
 *
 * The platform is explicitly multi-chain: a provider enrols per chain,
 * is paid at a different address per chain, and posts collateral per chain. So
 * a chain id stopped being a constant nobody had to read and became a label a
 * person has to be able to tell one row from another by.
 *
 * These are string functions and know nothing about any chain in particular —
 * which is the point. Nothing here may special-case a namespace, because the
 * first thing a hardcoded "Solana" does on an `eip155:*` row is lie about it.
 */

/**
 * `solana:EtWT…` / `eip155:4663` — a CAIP-2 id short enough for a stat cell.
 *
 * The reference is kept whole when it is short, because for `eip155` it *is*
 * the chain (4663 and 1 are different networks and the number is the only
 * thing that says so), and truncated when it is long, because a Solana genesis
 * hash is 32 bytes of base58 that no column can hold. The namespace alone
 * would be worse than either: it collapses mainnet and devnet into one word.
 */
export function chainLabel(chainId: string): string {
  const separator = chainId.indexOf(":");
  if (separator < 0) return chainId;

  const namespace = chainId.slice(0, separator);
  const reference = chainId.slice(separator + 1);
  if (reference.length <= 8) return `${namespace}:${reference}`;
  return `${namespace}:${reference.slice(0, 4)}…`;
}

/**
 * The CAIP-2 chain out of a CAIP-10 account id — `solana:<genesis>:<addr>`
 * gives `solana:<genesis>`.
 *
 * Returns `null` rather than a guess when the id is not CAIP-10. A caller
 * seeding a chain field needs to know it got nothing, so it can leave the
 * field for a person to fill instead of prefilling it with a wrong chain that
 * looks deliberate.
 */
export function chainIdOfAccount(accountId: string | null | undefined): string | null {
  if (!accountId) return null;
  const parts = accountId.split(":");
  if (parts.length < 3) return null;
  return `${parts[0]}:${parts[1]}`;
}

/**
 * The bare address out of a CAIP-10 account id — `eip155:46630:0x7fd9…` gives
 * `0x7fd9…`, `solana:<genesis>:<addr>` gives `<addr>`.
 *
 * **`""` for "unknown", never `undefined`**, and the distinction is the whole
 * reason this returns a string rather than `string | null`. It is fed to
 * `useSigner({ address })`, where `undefined` means *"sign as me — any wallet"*
 * and Privy then composes the list embedded-first. An empty string is a
 * *defined* address that no wallet matches, so the hook answers
 * `address-not-connected` and the screen says so, instead of silently signing
 * with a wallet that is not the one the contract will check the signature
 * against.
 *
 * Anything that is not CAIP-10 is returned whole rather than truncated: the
 * caller asked for an address and a partial one is worse than the original.
 */
export function addressOfAccount(accountId: string | null | undefined): string {
  if (!accountId) return "";
  const segments = accountId.split(":");
  return segments.length >= 3 ? segments[segments.length - 1] : accountId;
}

/**
 * The CAIP-2 chain out of a CAIP-19 asset id — `eip155:46630/erc20:0x915E…`
 * gives `eip155:46630`. `null` for anything that is not CAIP-19, for the reason
 * {@link chainIdOfAccount} gives.
 */
export function chainIdOfAsset(assetId: string | null | undefined): string | null {
  if (!assetId) return null;
  const slash = assetId.indexOf("/");
  if (slash < 0) return null;
  return chainIdOfAccount(`${assetId.slice(0, slash)}:x`);
}
