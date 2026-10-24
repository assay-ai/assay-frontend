/**
 * The provider surface's core shapes — the record itself, the label a
 * catalogue prints next to it, and the two things a provider agrees to.
 *
 * Taken from the backend DTOs, not from the OpenAPI document:
 * assay-backend `src/modules/provider/dto/get-provider-me.dto.ts` and
 * `provider-shared.dto.ts`.
 *
 * Two conventions this whole family follows:
 *
 *  - **Enums are string-literal unions.** The backend declares TypeScript
 *    enums; on the wire they are the strings below, and a union keeps the
 *    values usable in a `switch` without importing a runtime value.
 *  - **Timestamps are `string`.** Several backend DTOs declare `Date`
 *    (`ProviderPayoutDto.createdAt`, both `provedAt`, `expiresAt`,
 *    `pausedAt`, `publishedAt`, `ranAt`, `evaluatedAt`). Nest has already
 *    serialised them to ISO-8601 by the time they reach a browser, so the
 *    DTO misdescribes its own wire and the string is what actually arrives.
 *    `GetProviderStakeResponseDto` says so explicitly and commits to strings.
 */

/** `ProviderStatus`. */
export type ProviderStatus = "ACTIVE" | "SUSPENDED" | "UNBONDING";

/** `ProviderTier`. Earned, never chosen — `NEW` at registration. */
export type ProviderTier = "NEW" | "ESTABLISHED" | "TRUSTED";

/**
 * `ProviderStatsDto`.
 *
 * Every field is nullable and `null` means **not measured**, never zero — a
 * provider that has served nothing has no rate, and rendering `0%` for it
 * would read as "measured, and terrible". The backend port is explicit that
 * inventing a zero here starves a new provider of routing weight.
 */
export interface ProviderStats {
  /** 1 − SYSTEM_ERROR rate, rolling 24h. Shared across free and paid. */
  availabilityRate: number | null;
  /** PASS / DATA_RESULT on PAID calls, rolling 7d. Never folded with the free rate. */
  paidQualityRate: number | null;
  /** PASS / DATA_RESULT on FREE calls, rolling 7d. */
  freeQualityRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  callsServed: number | null;
  upheldSlashes: number | null;
}

/** `GET /providers/me` — `GetProviderMeResponseDto`. `id` is the organization id. */
export interface ProviderMe {
  id: string;
  status: ProviderStatus;
  tier: ProviderTier;
  stats: ProviderStats;
  /**
   * The chains this provider is on a slash hold on: its paid bindings are not
   * routed there while its penalties cannot be collected. Empty when none;
   * absent from a backend before the hold existed.
   */
  slashHolds?: ProviderSlashHold[];
}

/**
 * assay-backend `src/modules/provider/domain/slash-hold.ts` `SlashHoldReason`.
 *
 * - `SLASH_WINDOW_FULL`: the rolling slash window (the provider's or the
 *   verifier key's) is full and an upheld penalty is waiting to execute.
 * - `STAKE_FULLY_RESERVED`: pending penalties reserve the stake that could
 *   back another one.
 * - `BONDED_BELOW_MINIMUM`: the FREE bonded stake (`freeBondedOf` = bonded minus
 *   pending and disputed penalties, assay-evm D-26) is below `minimumStake`. A
 *   proposed penalty reserves stake at once, so it can cause this by itself.
 */
export type SlashHoldReason = "SLASH_WINDOW_FULL" | "STAKE_FULLY_RESERVED" | "BONDED_BELOW_MINIMUM";

/** `ProviderSlashHoldDto` — one chain's hold, for the provider console's banner. */
export interface ProviderSlashHold {
  /** CAIP-2, e.g. `eip155:46630`. */
  chainId: string;
  /** A newer backend may add a reason; it is shown as it came. */
  reasons: (SlashHoldReason | string)[];
  /** ISO-8601. */
  heldSince: string;
}

/** `ProviderContactDto` — a human, typed. Not a role alias, not free text. */
export interface ProviderContact {
  name: string;
  email: string;
  phone: string | null;
}

/** `ProviderContactInputDto` — the write side. `phone` may be omitted or cleared. */
export interface ProviderContactInput {
  name: string;
  email: string;
  phone?: string | null;
}

/** `AcceptedTermsDto` — which text of which document, and who accepted it. */
export interface AcceptedTerms {
  providerAgreementVersion: string;
  payoutTermsVersion: string;
  slashPolicyVersion: string;
  /** ISO-8601, UTC. Stamped by the server; a client never asserts it. */
  acceptedAt: string;
  /** The console credential that accepted. */
  acceptedBy: string;
}

/**
 * `AcceptedTermsInputDto` — the three versions a caller claims to accept.
 *
 * No `acceptedAt`/`acceptedBy`: those are not something a client gets to
 * assert about itself. A version that is not the currently published one is
 * refused with `PROVIDER_TERMS_VERSION_MISMATCH`.
 */
export interface AcceptedTermsInput {
  providerAgreementVersion: string;
  payoutTermsVersion: string;
  slashPolicyVersion: string;
}

/** One named finding inside a verification profile. */
export interface ProviderVerificationCheck {
  check: string;
  result: "PASS" | "FAIL" | "NOT_CHECKED";
  note: string | null;
}

/**
 * `ProviderVerificationDto` — the `verified` label.
 *
 * Named `…Label` because two buyer-side services already export a
 * `ProviderVerification` of a *different* shape (the wrapper carrying
 * `providerId` + `legalName`): `services/providers.service.ts` and
 * `services/explore.service.ts`. This is the inner object of that wrapper.
 *
 * Informational. It gates nothing — registration is open and publishing is
 * gated by the tester and stake, neither of which reads this. A client that
 * treats `verified: false` as "cannot be used" has invented an approval step
 * the platform does not have.
 */
export interface ProviderVerificationLabel {
  verified: boolean;
  /** Non-null exactly when `verified` is true — a DB CHECK refuses the other pairing. */
  verifiedBy: string | null;
  verifiedAt: string | null;
  method: string | null;
  checks: ProviderVerificationCheck[];
  /** When the label lapses. `null`: it does not. */
  expiresAt: string | null;
  evidenceUrl: string | null;
}
