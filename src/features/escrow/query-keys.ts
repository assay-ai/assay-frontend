/**
 * The escrow's query keys: one per endpoint, so every screen that reads it
 * shares the request and every write invalidates the one key it changed.
 */
export const escrowKeys = {
  /** Every escrow read (`GET /escrow`, any chain). */
  all: ["escrow"] as const,
  /** `GET /escrow` — the session's escrow (`null`) or the one on this chain. */
  escrow: (chainId: string | null) => ["escrow", chainId] as const,
  /** `GET /escrow/delegates` — the payer's on-chain pay permissions. */
  delegates: ["escrow-delegates"] as const,
};
