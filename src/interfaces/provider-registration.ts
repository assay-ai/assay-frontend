/**
 * Registration and onboarding — `POST /providers`,
 * `GET`/`PATCH /providers/me/registration`, and the connectivity probe that
 * step 3 of onboarding runs.
 *
 * Source: assay-backend `src/modules/provider/dto/register-provider.dto.ts`,
 * `get-provider-registration.dto.ts` and `check-connectivity.dto.ts`.
 */

import type {
  AcceptedTerms,
  AcceptedTermsInput,
  ProviderContact,
  ProviderContactInput,
  ProviderStatus,
  ProviderTier,
  ProviderVerificationLabel,
} from "./provider";

/**
 * `RegisterProviderBodyDto`.
 *
 * `endpoint` and the payout addresses are deliberately absent: each is proved
 * through its own signed flow. A registration body that accepted either would
 * let a caller claim a payout address with no signature behind it.
 *
 * `ownerContact` must not share an inbox with `technicalContact` —
 * `PROVIDER_CONTACTS_NOT_DISTINCT` otherwise.
 */
export interface RegisterProviderBody {
  legalName: string;
  technicalContact: ProviderContactInput;
  ownerContact: ProviderContactInput;
  /** An IANA zone name. Every deadline the platform quotes is counted here. */
  timezone: string;
  acceptedTerms: AcceptedTermsInput;
}

/**
 * `ProviderRegistrationRecordDto` — the row, wherever it is read.
 *
 * Also the whole of `POST /providers`'s 201 response: registration is open,
 * there is no pending-approval state.
 */
export interface ProviderRegistrationRecord {
  id: string;
  legalName: string;
  technicalContact: ProviderContact;
  ownerContact: ProviderContact;
  timezone: string;
  acceptedTerms: AcceptedTerms;
  /** Always `ACTIVE` on a freshly registered row — there is no `PENDING`. */
  status: ProviderStatus;
  /** Always `NEW` at registration. */
  tier: ProviderTier;
  /**
   * One entry per chain this provider has proved an address on.
   *
   * **A list, never one address, and empty is a real state** — a provider who
   * has proved nothing yet. It replaced a single `payoutAccountId`, which
   * could only ever name one chain: a provider paid on Solana and on
   * `eip155:4663` has two payout addresses, and collapsing them showed an
   * address that is true on one chain and false on the other with nothing on
   * screen saying which.
   */
  payoutAccounts: ProviderPayoutAccount[];
  /** `null` until an endpoint is declared and found reachable. */
  endpoint: string | null;
  verification: ProviderVerificationLabel;
  registeredAt: string;
}

/**
 * `ChainEnrolmentStatus` — the ENROLMENT's lifecycle on one chain, which is
 * not the provider's. A provider suspended on one chain is not suspended on
 * the other, while the reputation that suspended them is shared.
 *
 * **Only `ACTIVE` is payable.** The backend refuses every paid binding on a
 * chain whose enrolment is `SUSPENDED` or `UNBONDING` — even though the
 * address on that enrolment is proved. So a proved address is not a tick: the
 * address answers "where", the status answers "whether", and the second is the
 * half that decides whether money arrives.
 */
export type ChainEnrolmentStatus = "ACTIVE" | "SUSPENDED" | "UNBONDING";

/**
 * `ProviderPayoutAccountDto` — one chain, the address proved on it, and
 * whether that enrolment is live.
 *
 * Re-proving an address does **not** reset {@link status}: the backend's
 * upsert leaves `status` and `enrolled_at` out of its update list on purpose,
 * so a `SUSPENDED` enrolment cannot be made routable again by its owner
 * signing a message. Nothing on this screen may imply otherwise.
 */
export interface ProviderPayoutAccount {
  /** CAIP-2. */
  chainId: string;
  /** CAIP-10, on `chainId`. Proved by a signature. */
  accountId: string;
  /** ISO-8601, UTC — when the signature proved it. */
  provedAt: string;
  status: ChainEnrolmentStatus;
}

/** The four onboarding steps, in display order. */
export type ProviderOnboardingStepKey = "account" | "payoutWallet" | "endpoint" | "terms";

export type OnboardingStepStatus = "NOT_STARTED" | "IN_PROGRESS" | "DONE";

export interface ProviderOnboardingStep {
  key: ProviderOnboardingStepKey;
  title: string;
  caption: string;
  status: OnboardingStepStatus;
}

/** One row of the commercial-terms table. Rendered verbatim — the server writes the copy. */
export interface ProviderCommercialTerm {
  key: string;
  label: string;
  value: string;
  caption: string;
}

export interface ProviderTermsSummary {
  providerAgreementVersion: string;
  payoutTermsVersion: string;
  slashPolicyVersion: string;
  /** The sentence beside the checkbox, already assembled. Do not rebuild it locally. */
  acceptanceLine: string;
  commercialTerms: ProviderCommercialTerm[];
}

/** What a connectivity probe concluded. */
export type ConnectivityOutcome = "REACHABLE" | "UNREACHABLE" | "BLOCKED";

/**
 * `ConnectivityCheckResultDto`.
 *
 * `BLOCKED` is not a failure to reach: it means the egress guard refused to
 * dial at all — a private, loopback, link-local or metadata address, or a
 * scheme the platform does not speak. Telling that provider "we could not
 * reach you" would be true and useless, so the three outcomes stay distinct.
 */
export interface ConnectivityCheckResult {
  outcome: ConnectivityOutcome;
  endpoint: string;
  /** Whatever answered, including 4xx — a 401 is a pass. `null` when nothing answered. */
  statusCode: number | null;
  latencyMs: number | null;
  failureKind: string | null;
  /** An `EGRESS_*` code, when there was one. */
  failureCode: string | null;
  detail: string | null;
  checkedAt: string;
}

/**
 * `CheckConnectivityResponseDto`. `saved` is present and `true` only on the
 * declare-endpoint call; the read-only probe never writes the provider row.
 */
export interface CheckConnectivityResponse extends ConnectivityCheckResult {
  saved?: boolean;
}

/**
 * `GET`/`PATCH /providers/me/registration` — the whole onboarding state in
 * one call rather than four, because one step counter spans all four steps.
 */
export interface ProviderRegistrationState {
  registration: ProviderRegistrationRecord;
  steps: ProviderOnboardingStep[];
  /** 1-based ordinal of the first non-DONE step, or `totalSteps` when all are DONE. */
  currentStep: number;
  totalSteps: number;
  terms: ProviderTermsSummary;
  /** The latest probe of any endpoint this provider has declared. */
  lastConnectivityCheck: ConnectivityCheckResult | null;
}

/**
 * `UpdateProviderAccountBodyDto`. Every field optional.
 *
 * Sending `acceptedTerms` re-accepts and re-stamps; omitting it leaves the
 * existing acceptance untouched — a legal-name edit is not a re-acceptance.
 */
export interface UpdateProviderAccountBody {
  legalName?: string;
  technicalContact?: ProviderContactInput;
  ownerContact?: ProviderContactInput;
  timezone?: string;
  acceptedTerms?: AcceptedTermsInput;
}
