/**
 * The deployment's CAIP-2 chain ids. Until this existed the devnet id was a
 * bare literal inside `useSigner`'s chain map, which is not importable — and
 * more call sites now need it. `useSigner` keys its map off these constants
 * rather than keeping a second copy that can drift.
 *
 * They are truncated base58 genesis hashes, copied from the backend's own
 * registry (assay-backend `src/modules/chains/ports/caip.types.ts`, `CHAIN_IDS`).
 * Do not retype them from memory — a wrong character here does not fail to
 * compile, it fails on chain.
 */
export const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/**
 * The devnet RPC the BROWSER uses, and it is deliberately the public endpoint.
 *
 * Privy refuses to sign without an RPC for the chain (`No RPC configuration
 * found for chain solana:devnet`), so `providers/index.tsx` must declare one.
 * A keyed RPC endpoint carries an API key,
 * and anything a browser reads is in the bundle — so the browser gets the
 * public endpoint and the backend keeps the private one.
 *
 * Public devnet rate-limits. One transaction per user action is fine; polling
 * is not. Do not build a poll on this.
 */
export const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const SOLANA_DEVNET_WS_URL = "wss://api.devnet.solana.com";
