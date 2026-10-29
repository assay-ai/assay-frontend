import { publicApi } from "./public-api";

export type AnalyticsRange = "7d" | "30d" | "90d" | "all";

export interface AnalyticsAsset {
  id: string;
  chainId: string;
  chainName: string;
  symbol: string;
  decimals: number;
}

/** Amounts are integer strings in the selected asset's atomic units. */
export interface AnalyticsFigures {
  paidCalls: number;
  payingAgents: number;
  toolsEarning: number;
  collectedCalls: number;
  refundedCalls: number;
  pendingCalls: number;
  volume: string;
  revenue: string;
  providerEarnings: string;
  refunded: string;
  pending: string;
  notCharged: string;
  passRate: number | null;
}

export interface AnalyticsDay extends AnalyticsFigures {
  day: string;
  agentsSinceLaunch: number;
  toolsSinceLaunch: number;
}

export interface AnalyticsTool {
  name: string;
  category: string;
  paidCalls: number;
  volume: string;
  collectedCalls: number;
  refundedCalls: number;
  passRate: number | null;
}

/** Coarse daily groups, never individual buyer payments. */
export interface AnalyticsPaymentGroup {
  day: string;
  tool: string;
  paidCalls: number;
  collectedCalls: number;
  refundedCalls: number;
  volume: string;
}

export interface ProtocolAnalyticsResponse {
  state: "OK" | "UNAVAILABLE";
  generatedAt: string;
  cacheTtlMs: number;
  assets: AnalyticsAsset[];
  asset: AnalyticsAsset | null;
  range: AnalyticsRange;
  window: { from: string; to: string; chartFrom: string } | null;
  totals: AnalyticsFigures | null;
  previous: AnalyticsFigures | null;
  daily: AnalyticsDay[];
  topTools: AnalyticsTool[];
  recent: AnalyticsPaymentGroup[];
  escrow: { available: string; held: string } | null;
  withheldForPrivacy: boolean;
}

export function getProtocolAnalytics(
  range: AnalyticsRange,
  asset?: string,
): Promise<ProtocolAnalyticsResponse> {
  return publicApi.get<ProtocolAnalyticsResponse>("/public/analytics", {
    range,
    ...(asset ? { asset } : {}),
  });
}
