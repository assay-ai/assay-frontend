import type { ProofTypedData } from "./provider-payouts";
/**
 * Capital — the stake position, the stake-authority proof, and the four
 * unsigned stake intents.
 *
 * Source: assay-backend `src/modules/provider/dto/get-provider-stake.dto.ts`,
 * `create-stake-intent.dto.ts` and `prove-stake-authority.dto.ts`.
 *
 * **Absent is not zero, in three separate places on this response.** A
 * provider missing from the stake source has *no known stake* — an RPC that
 * failed and a provider that never bonded both read as absent — while a zero
 * stake means "we asked, and the answer was zero". `hasKnownStake`,
 * `chainReadable` and a `null` `requirementTotal` each put one of those
 * distinctions on the wire so a client never has to infer it from missing
 * JSON. Collapsing any of them makes an RPC outage indistinguishable from an
 * unbonded provider, on the one screen read to find out whether paid traffic
 * can flow.
 *
 * **And the first two are PER CHAIN** — see `ProviderChainStake`. Reconciled
 * against the backend's `GetProviderStakeResponseDto` and a live
 * `GET /providers/me/stake`, after an earlier flat declaration made six
 * screens misreport a real $500 stake.
 */

import type { UnsignedChainTransaction } from "./chain-transaction";

import type { Money } from "./api";

/**
 * The rule that combines the per-binding minima into `requirementTotal`.
 *
 * **`max`, not `sum`** — and the constant is a single literal because three
 * documents still say otherwise. The gate is evaluated per binding, so under
 * `sum` publishing a second binding could retroactively make the first
 * unroutable. Print this value; do not hardcode the word.
 */
export type StakeRequirementRule = "max";

/**
 * One open grace period, for **one binding**.
 *
 * Per binding, never per provider: the requirement is computed per binding, so
 * one provider can hold three grace periods with three different deadlines at
 * once. A single provider-level countdown would have to be wrong about at
 * least two of them, and the ones it silently dropped are the bindings whose
 * traffic stops first.
 */
export interface ProviderStakeGrace {
  /** When the shortfall was first observed. Written once, never moved. */
  startedAt: string;
  /** Stored when the row opened, never re-derived — a policy change must not shorten a running clock. */
  expiresAt: string;
  /** Requirement minus stake, **frozen at the moment the period opened**. */
  shortfall: Money;
  /**
   * `now >= expiresAt`. The row is still returned after expiry, deliberately:
   * between the deadline and the monitor's next 5-minute tick, "your grace ran
   * out" is a different sentence from "you are below the minimum", and only
   * the first one explains why the traffic stopped.
   */
  expired: boolean;
}

/** One binding's contribution to the requirement. */
export interface ProviderStakeRequirementItem {
  bindingId: string;
  toolId: string;
  /** PAID or FREEMIUM. FREE bindings need no stake and are not listed. */
  pricingMode: string;
  /** `null` only when the binding is priced in an asset the stake floor is not denominated in. */
  price: Money | null;
  /**
   * What this binding alone requires. `null` when priced in another asset —
   * the gate refuses it as `STAKE_ASSET_MISMATCH` rather than converting,
   * because a rate would silently move the floor. Such a binding is listed
   * anyway: it is not routable, and hiding it would leave the provider
   * without the reason.
   */
  minimum: Money | null;
  /** How `minimum` was arrived at, as one line to print verbatim. */
  derivation: string;
  grace: ProviderStakeGrace | null;
}

/** Enough to draw one banner. **Not** the source of truth — that is `requirement[].grace`. */
export interface ProviderStakeGraceSummary {
  bindingsInGrace: number;
  earliestExpiresAt: string;
}

/**
 * One chain's stake — `ProviderChainStakeDto`, field for field.
 *
 * ## Why this is a list and not a figure
 *
 * A call is slashed in the settlement contract of the chain it was paid on, so
 * collateral on Solana is invisible and unreachable to `X402Stake` on an EVM
 * chain: a provider serving two chains must stake on both. A sum across chains
 * is therefore the one number that is never true, because no single call is
 * backed by it.
 *
 * ## Three states per chain, and none may collapse into another
 *
 * ```text
 *  hasKnownStake  staked         meaning
 *  true           { amount }     the source answered, with this much
 *  true           { amount: 0 }  the source answered, and the answer was ZERO
 *  false          null           the source has no reading — NEVER a zero
 * ```
 *
 * `hasKnownStake` and `chainReadable` are two different unknowns and both are
 * per chain, because both failures are per chain: an RPC outage is an outage
 * of one network, and reporting it against a chain that answered fine is a
 * fabricated incident. Render all of it through `@/features/chain-read`.
 */
export interface ProviderChainStake {
  /** CAIP-2. Every other field on this entry is about THIS chain only. */
  chainId: string;
  /** False when the stake source has no reading for this provider ON THIS CHAIN. */
  hasKnownStake: boolean;
  /** `null` when `hasKnownStake` is false. Never a synthetic zero. */
  staked: Money | null;
  /** When `staked` was read. `null` when `hasKnownStake` is false. */
  observedAt: string | null;
  /**
   * Stake asked out on THIS chain, still inside the unbonding period.
   * **Never part of `staked`** — the routing gate is `bonded >= minimum`, and
   * folding the two would let a provider request a full unstake and keep
   * serving paid traffic for the whole period.
   */
  unbonding: Money | null;
  unbondingStartedAt: string | null;
  unbondingCompletesAt: string | null;
  /**
   * False when THIS chain could not be read on this request, in which case
   * `unbonding` and its two timestamps are `null` because they are *unknown*.
   * True with them still null means either there is no `stakeAuthority` on
   * this chain or the chain answered and there is no stake account.
   */
  chainReadable: boolean;
  /**
   * The CAIP-10 account on THIS chain whose stake account backs this provider,
   * or `null` if the provider has not signed the challenge for one. One per
   * chain, never one overall — migration `1759300000003` deleted the
   * provider-wide `providers.stake_authority` for exactly this reason.
   */
  stakeAuthority: string | null;
}

/**
 * `GET /providers/me/stake`.
 *
 * ## The stake became a list on 2026-09-11, and this mirror had not noticed
 *
 * `staked`, `observedAt`, `unbonding`, `unbondingStartedAt`,
 * `unbondingCompletesAt`, `hasKnownStake`, `chainReadable` and
 * `stakeAuthority` were declared here at the top level and the backend had
 * already moved every one of them onto {@link ProviderChainStake}. Because the
 * type still promised them, six screens read `data.staked` and
 * `data.chainReadable`, got `undefined`, and said so confidently: a provider
 * with a **confirmed $500 stake on a readable chain** was shown "The chain
 * could not be read" and every figure as an em dash. Nothing failed. No test,
 * no build and no type-check compared the two sides — which is why the fix is
 * this declaration and not a null guard on the page.
 *
 * ## `requirement` is per BINDING, and is still not per chain
 *
 * {@link stake} and {@link requirement} are not parallel lists and must not be
 * read as though they were: the gate is evaluated per binding, so the
 * requirement is itemised per binding. `requirementTotal`, `headroom`,
 * `shortfall` and `recommendedBuffer` are denominated in the stake floor's
 * single asset and are therefore about **that chain alone** — they compare
 * against that chain's entry in {@link stake} and nothing else.
 *
 * That is a known limitation of the endpoint, not an oversight on this side:
 * a per-chain requirement needs the per-chain floor threaded through the
 * backend service and is recorded as deferred work there. Do not "fix" it here
 * by fanning the single figure out across chains — that would print a floor
 * against a chain it was never computed for.
 */
export interface ProviderStake {
  /**
   * The stake, **per chain — a list, never a sum**.
   *
   * One entry per chain the provider is enrolled on, plus the stake floor's
   * own chain always. Sorted by `chainId`. Never empty on a real provider.
   *
   * There is deliberately no response-level total and no response-level
   * `hasKnownStake`: either would be a claim across chains, and no call is
   * ever backed by more than one of them.
   */
  stake: ProviderChainStake[];
  /** Ordered by tool id then binding id. ACTIVE PAID/FREEMIUM bindings only. */
  requirement: ProviderStakeRequirementItem[];
  requirementRule: StakeRequirementRule;
  /** `max` over `requirement[].minimum`. `null` = nothing to stake against, not $0 required. */
  requirementTotal: Money | null;
  /** A negotiated floor, populated independently of `requirementTotal`. */
  negotiatedMinimum: Money | null;
  graceSummary: ProviderStakeGraceSummary | null;
  /** `staked - requirementTotal`, floored at zero. */
  headroom: Money | null;
  /** `requirementTotal - staked`, floored at zero. Exactly one of the two is ever non-zero. */
  shortfall: Money | null;
  /** 1.5x `requirementTotal` — a buffer means never using the grace period. */
  recommendedBuffer: Money | null;
}

// ── Stake authority proof ──────────────────────────────────────────────────

/**
 * `POST /providers/me/stake-authority/challenge`.
 *
 * A CAIP-2 chain id plus a chain-native address, not a CAIP-10 id: a bare
 * address means nothing without knowing which chain validated it, and the
 * chain travelling with the key is what stops a devnet stake account being
 * read as the mainnet one a slash attestation would point at.
 */
export interface StakeAuthorityChallengeBody {
  chainId: string;
  /** e.g. a base58 Solana pubkey. */
  address: string;
}

/**
 * `message` is the exact string the wallet must be asked to sign. The console
 * does not, and must not, construct it locally — the stored row is the only
 * copy the prove call ever verifies against.
 */
export interface StakeAuthorityChallenge {
  challengeId: string;
  /** 32 random bytes, lower-case hex. */
  nonce: string;
  message: string;
  messageVersion: string;
  /** CAIP-10 — the canonical form of the account being claimed. */
  accountId: string;
  expiresAt: string;
  /** eip155: what the wallet signs (EIP-712). `null` on Solana, where `message` is. */
  typedData: ProofTypedData | null;
}

/**
 * `POST /providers/me/stake-authority`.
 *
 * Deliberately only these two fields. A request that could name the pubkey is
 * a request provider A could point at provider B's collateral.
 */
export interface ProveStakeAuthorityBody {
  challengeId: string;
  /** Solana: base58 ed25519 over `message`. eip155: 0x-hex EIP-712 over `typedData`. */
  signature: string;
}

export interface StakeAuthorityProof {
  challengeId: string;
  signature: string;
  /** Says which of the two proof flows this envelope came from. */
  messageVersion: string;
  provedAt: string;
}

export interface ProveStakeAuthorityResponse {
  /** CAIP-10 — now the account whose stake PDA backs this provider. */
  stakeAuthority: string;
  provedAt: string;
  proof: StakeAuthorityProof;
}

// ── Stake intents ──────────────────────────────────────────────────────────

export type StakeIntentKind = "OPEN_STAKE" | "DEPOSIT" | "UNSTAKE" | "WITHDRAW";

/**
 * Which limit refused a withdrawal. One reason in the current program version.
 *
 * `EXPOSURE` is gone with the exposure authority: nothing asserts a served-call
 * liability on chain any more. The program bounds a withdrawal arithmetically
 * instead — `withdrawable = min(matured unbonding, bonded + unbonding −
 * pending_slash)`, with `WITHDRAW_DELAY_SECONDS` longer than a voucher's
 * redeemable life — so the only thing a provider can be *told to wait for* is
 * the unbonding clock. A union of one is kept rather than collapsed to a
 * string so a second reason is an added member, not a new shape.
 */
export type StakeWithdrawalBlocker = "UNBONDING_NOT_MATURED";

/**
 * The body of deposit / unstake / withdraw. Open-stake takes **no body**.
 *
 * The asset is not on the request: stake is denominated in the program's
 * configured mint and nothing else, so a caller-supplied asset could only ever
 * be right or rejected.
 */
export interface CreateStakeIntentBody {
  /** Atomic units of the stake asset, as a decimal integer string. Never a number. */
  amount: string;
}

/** What renders above the "Sign in your wallet" button. */
export interface StakeIntentPreflight {
  /** `"0"` for every kind but DEPOSIT. */
  requiredStakeAsset: Money;
  /**
   * What the stake authority's own token account holds, or `null` when there
   * is no such account. Null is not zero: no account needs one created, an
   * empty one needs USDC, and those are different errands.
   */
  stakeAssetBalance: Money | null;
  /** The gas budget in the chain's native asset (SOL, 9 decimals). A ceiling, not a quote. */
  requiredGas: Money;
  gasBalance: Money;
  /** False when the balance is unknown — an absent token account is never read as enough. */
  hasEnoughStakeAsset: boolean;
  hasEnoughGas: boolean;
  /** Always false. The platform sponsors an agent's x402 payment, not this. */
  gasSponsored: boolean;
  /** The platform's own sentence, so the screen prints it rather than inventing one. */
  gasNotSponsoredReason: string;
}

/**
 * The payload a provider's wallet is handed. Unsigned, always.
 *
 * Was a flat Solana shape (`transactionBase64`, `feePayer`, `signers`,
 * `blockhash`, `lastValidBlockHeight`). The wire now carries the
 * three-member union; those five fields survive as the `solana` member's
 * fields and nothing else carries them. A screen that wants to print a fee
 * payer must narrow with `isSolanaTransaction` first — there is no fee payer
 * on either `eip155` member, and one of them is not a transaction at all.
 */
export type UnsignedStakeTransaction = UnsignedChainTransaction;

/**
 * One response shape for all four intents.
 *
 * `transaction` being nullable is the feature: a withdrawal the chain would
 * reject is not returned at all, because handing it over would charge the
 * provider a network fee to be told something this response already knows.
 * When `blockedBy` is set, `transaction` is `null` and `withdrawable` says
 * what would have gone through. Still a 201 — the request was answered, and
 * the answer is the limit.
 */
export interface StakeIntent {
  kind: StakeIntentKind;
  /** The CAIP-10 stake authority this was built for. Never taken from the request. */
  account: string;
  /** `null` for OPEN_STAKE, which carries no amount. */
  amount: Money | null;
  transaction: UnsignedStakeTransaction | null;
  preflight: StakeIntentPreflight;
  /** WITHDRAW only. `null` for the other three kinds. */
  withdrawable: Money | null;
  /** WITHDRAW only, and `null` when the requested amount is within `withdrawable`. */
  blockedBy: StakeWithdrawalBlocker | null;
}
