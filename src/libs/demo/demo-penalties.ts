/**
 * DEMO ONLY: the on-chain penalty records the demo provider has.
 *
 * The penalties page reads the stake contract straight from the chain, which
 * no fixture can answer (it is an RPC read, not an Assay API path). With the
 * demo flag on, `usePenalties` uses these rows instead — one that needs
 * action, one disputed, one closed — and each is matched to an Assay case the
 * provider fixtures answer (`/providers/me/slash-proposals/:id`). No state:
 * every read returns the same three rows, dated relative to now.
 */

/** Assay case ids, in the order: needs action, disputed, closed. */
export const DEMO_PENALTY_PROPOSALS = [
  "c3e1a7b2-5d94-4f08-a61e-2b7d90f4c815",
  "a91c35e7-0b62-4d84-9f3a-6c81e740d2b5",
  "e8f24d16-73a0-4b9c-8d25-61c0a9b3e47f",
] as const;

/** On-chain request ids for the same three records. */
export const DEMO_PENALTY_REQUESTS = [
  "0x4b1f9e2a7c3d58e06a91b4f27d8c3e5a90b16f2d4e7c8a3b5f9d0e1c2a4b6d8e",
  "0x9a7c2e4f6b8d0a1c3e5f7092b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2",
  "0x1d3f5b7d9f1b3d5f7b9d1f3b5d7f9b1d3f5b7d9f1b3d5f7b9d1f3b5d7f9b1d3f",
] as const;

/**
 * Major amounts, 6 decimals — the real formula applied to each subject window
 * (see the WINDOWS note in `fixtures-provider.ts`), so the drawer's
 * derivation, the Quality tab and the amount agree.
 */
export const DEMO_PENALTY_AMOUNTS = ["28.408752", "11.041313", "7.542652"] as const;

/** Binding index (in the provider fixtures) and window index per record: w_117, w_46, w_45 — each a window that went over the promise. */
export const DEMO_PENALTY_SUBJECTS = [
  { bindingIndex: 0, windowIndex: 1 },
  { bindingIndex: 1, windowIndex: 2 },
  { bindingIndex: 1, windowIndex: 3 },
] as const;
