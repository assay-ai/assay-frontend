/**
 * The chains this deployment offers — `GET /api/v1/chains`.
 *
 * Field-for-field `ChainDto` / `GetChainsResponseDto` from the
 * assay-backend repository:
 *
 * ```text
 * assay-backend src/modules/chains/dto/get-chains.dto.ts
 * assay-backend src/modules/chains/controllers/chains.controller.ts
 *   → @Controller('chains'), @Get() list(): GetChainsResponseDto
 * ```
 *
 * Older backend versions do not have the chains module; if you go looking and
 * find nothing, check which backend version you are on before concluding the
 * route is missing.
 *
 * All six fields below match the DTO by name and by type, and the response
 * envelope matches too (`{ chains: ChainDto[] }`). So `useChains()` reaches its
 * **ready** state against a real backend, and the `error` branch is a failure
 * path, not the normal case.
 *
 * **There is still no sync guard.** This is a hand mirror: nothing fails if a
 * field is renamed on the backend side, and three of the six are strings a
 * screen renders directly, so a rename surfaces as a blank label or a dead
 * explorer link rather than as an error. Re-diff against that file whenever
 * either side changes.
 *
 * **This is the only source of the enabled set.** The frontend's chain
 * registry holds static per-chain metadata and never the enabled list, because
 * a build-time copy drifts from the deployment and the failure is a user shown
 * a chain the API then refuses. `libs/chains/registry.ts` therefore holds no
 * table at all — only what a CAIP-2 id says about itself.
 */
export interface Chain {
  /** CAIP-2. */
  chainId: string;
  /** CAIP-2 namespace — `solana`, `eip155`. Sent by the API; also derivable from `chainId`. */
  namespace: string;
  /** For people. `Solana devnet`, `Robinhood Chain testnet`. Never assembled on the client. */
  displayName: string;
  /**
   * The explorer's base, which MAY carry a query string
   * (`https://explorer.solana.com/?cluster=devnet`). Build links with
   * `libs/chains/explorer.ts`, never with a template literal.
   */
  explorerBaseUrl: string;
  /** CAIP-19. The one asset this chain settles in. */
  settlementAsset: string;
  /**
   * That asset's ticker, for people — `USDC` on Solana, **`USDG` on Robinhood
   * Chain testnet**.
   *
   * Served because it could not be derived. `settlementAsset` above is
   * `eip155:46630/erc20:0x915Ef7c9…`, which says nothing a buyer can read, and
   * the only client-side way to turn a chain id into a ticker is a table of
   * chain ids — the exact build-time copy this design avoids, one column narrower.
   * So the backend serves it off `asset-registry.ts`, where the symbol is
   * recorded beside the scale, and this field is the whole reason the funding
   * screens no longer print the literal `USDC` at a buyer whose money is USDG.
   *
   * Read it with `settlementSymbol()` in `services/chains.service.ts`, which
   * answers `null` for a chain this list does not carry. Never `chains[0]`.
   */
  settlementAssetSymbol: string;
  /** The settlement asset's scale. 6 on every registered asset today. */
  decimals: number;
  /**
   * A PUBLIC JSON-RPC endpoint for this chain, when the deployment names one.
   *
   * What the browser fills an eip155 transaction from — nonce, gas, fees —
   * before the wallet signs it, and what Privy's `supportedChains` is built
   * out of. It is served rather than built in so that it always matches the
   * deployment's enabled chains, instead of a value baked in at build time.
   *
   * Absent means this deployment offers no public endpoint for the chain.
   * Refuse the chain by name; never dial an empty string.
   */
  publicRpcUrl?: string;
  /** The settlement contracts of this chain. Absent on a chain with none (Solana). */
  contracts?: ChainContracts;
  /**
   * The parameters the settlement contracts hold, as the backend last read
   * them (`ChainParamsDto`). The chain is the source of truth: every screen
   * renders these through `libs/chain-terms.ts` and never a copy of its own.
   * Absent on a chain with none.
   */
  params?: ChainParams;
}

export interface ChainContracts {
  config: string;
  stake: string;
  escrow: string;
  asset: string;
}

/**
 * `ChainParamsDto` from assay-backend `src/modules/chains/dto/get-chains.dto.ts`.
 * Amounts are atomic units of the settlement asset (scale `Chain.decimals`).
 * `null` is "not known yet": render "—", never a guess.
 */
export interface ChainParams {
  /** `chain`: read from the contracts. `config`: the backend could not read them yet. */
  source: "chain" | "config";
  readAt: string | null;
  minimumStake: string | null;
  /** The most one attestation (one record) can slash. */
  penaltyAmount: string | null;
  takeRateBps: number | null;
  slashAgentBps: number | null;
  slashPlatformBps: number | null;
  /** Most of the stake at risk slashed per provider per rolling 24 h. */
  slashCapBps: number | null;
  unbondingPeriodSeconds: number | null;
  slashDelaySeconds: number | null;
  /** The delay a provider actually gets: the larger of the chain's and the platform's floor. */
  effectiveSlashDelaySeconds: number;
  /** The dispute hold on every paid call. */
  collectHoldSeconds: number | null;
  withdrawDelaySeconds: number;
  tightenDelaySeconds: number;
  redeemGraceSeconds: number;
  heldTimeoutSeconds: number;
  disputeTimeoutSeconds: number;
  paused: boolean | null;
  arbiter: string | null;
}

export interface GetChainsResponse {
  /** Exactly the chains `ENABLED_CHAINS` names, in that order. */
  chains: Chain[];
}
