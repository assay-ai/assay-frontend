import type { SlashProposalClocks } from "@/interfaces/provider-disputes";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";

/**
 * The R13 on-chain dispute test's case, as the backend served it: proposed
 * 08:36 with Assay's promise `earliestExecutionAt` at the same minute (the
 * seeded test case), the on-chain record proposed 08:37 with a one-hour delay
 * (`chainExecutableAt` 09:37), disputed on chain at 08:58:08.
 */
export const R13 = {
  proposedAt: "2026-10-15T08:36:00.000Z",
  earliestExecutionAt: "2026-10-15T08:36:00.000Z",
  respondByAt: "2026-10-17T08:36:00.000Z",
  chainExecutableAt: "2026-10-15T09:37:00.000Z",
  chainDisputedAt: "2026-10-15T08:58:08.000Z",
} as const;

const USDG = "eip155:46630/erc20:0x0000000000000000000000000000000000000001";
const money = (amount: string) => ({ amount, asset: USDG, decimals: 6 });

export function clocksOf(overrides: Partial<SlashProposalClocks> = {}): SlashProposalClocks {
  return {
    proposedAt: R13.proposedAt,
    notifiedAt: R13.proposedAt,
    acknowledgedAt: null,
    respondByAt: R13.respondByAt,
    platformDecisionDueAt: null,
    earliestExecutionAt: R13.earliestExecutionAt,
    chainExecutableAt: R13.chainExecutableAt,
    chainStatus: "PENDING",
    chainDisputedAt: null,
    chainDisputedParts: 0,
    secondsRemaining: 3_600,
    runningClock: "PROVIDER",
    ...overrides,
  };
}

/** Disputed on chain: the watcher moved the case into review, so Assay's clock runs. */
export const DISPUTED_CLOCKS: Partial<SlashProposalClocks> = {
  chainStatus: "DISPUTED",
  chainDisputedAt: R13.chainDisputedAt,
  chainDisputedParts: 1,
  platformDecisionDueAt: "2026-10-16T07:58:00.000Z",
  secondsRemaining: 82_740,
  runningClock: "PLATFORM",
};

/** Upheld by the arbiter: Pending again, disputedAt kept, no part disputed. */
export const UPHELD_CLOCKS: Partial<SlashProposalClocks> = {
  ...DISPUTED_CLOCKS,
  chainStatus: "PENDING",
  chainDisputedParts: 0,
};

export function caseOf(
  status: string,
  clocks: Partial<SlashProposalClocks> = {},
  extra: { disputeId?: string | null } = {},
): SlashProposalCaseDetail {
  return {
    proposal: {
      id: "28150000-0000-4000-8000-000000000003",
      status,
      providerId: "org_provider",
      bindingId: "39421075-5823-4b1e-9f0e-000000000000",
      bindingLabel: "b_3942",
      toolId: "search_web",
      toolName: "search_web",
      windowId: null,
      windowLabel: null,
      penaltyAmount: money("30000"),
      appliedAmount: null,
      clocks: clocksOf(clocks),
      disputeId: extra.disputeId ?? null,
      outcome: null,
      resolutionKind: null,
      resolvedAt: null,
      executedAt: null,
    },
    changeOverlay: null,
    failuresByAgent: [],
    evidenceVerdictCount: 0,
    suggestedClaim: null,
    inaction: {
      executesAt: R13.earliestExecutionAt,
      stakeBefore: money("1000000"),
      stakeAfter: money("970000"),
      minimumRequired: money("500000"),
      fallsBelowMinimum: false,
      graceHours: null,
      projectedRestoreHours: null,
      routingContinues: true,
    },
    arithmetic: [],
    priorWindows: [],
    failuresByRule: [],
  };
}

/** The visible text of a render, with every tag and attribute removed. */
export function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}
