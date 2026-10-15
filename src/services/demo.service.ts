import { ApiError } from "@/libs/ApiClient";

import { api } from "./api";
import { getPublicFeatures } from "./public-features.service";

/**
 * The public live demo — two real, paid calls run from the browser.
 *
 * Anonymous, like `reserves.service.ts`: `ApiClient` attaches `Authorization`
 * only when a token exists, so a signed-out visitor already sends none.
 *
 * ## Money arrives in the SECOND phase, never the first
 *
 * `runDemo` returns the **listed** price and nothing else about money. The
 * failing call reports a charge at the synchronous step and is refunded only
 * once the worker has judged it, so a figure in phase one would make the page
 * print "You paid $0.0100" and then correct itself to `$0.0000` in front of the
 * reader. `pollDemoVerdict` is where `paid` and `notCharged` become known.
 */

export enum DemoVerdictState {
  PENDING = "PENDING",
  READY = "READY",
  /** Refunded synchronously — no verdict is coming, ever. Do not keep polling. */
  SETTLED_WITHOUT_JUDGEMENT = "SETTLED_WITHOUT_JUDGEMENT",
  /** No verdict inside the deadline. Said plainly rather than spun on. */
  GAVE_UP = "GAVE_UP",
}

export interface DemoMoney {
  amount: string;
  asset: string;
  decimals: number;
}

export interface DemoRunResult {
  /** Poll key. The intent id — see the backend service for why not the call id. */
  intentId: string | null;
  status: "RESULT" | "ERROR";
  latencyMs: number;
  body: unknown;
  listedPrice: DemoMoney;
  /**
   * Set when the broken side could not demonstrate a refusal for this query.
   *
   * The broken binding fails only when the upstream returns two or more rows,
   * and the visitor types the query. Fewer than two results means the
   * duplicate-id check had nothing to compare — the page says so instead of
   * presenting a pass as though the demo had worked.
   */
  inconclusive: string | null;
}

export interface DemoVerdict {
  state: DemoVerdictState;
  stages: DemoStage[] | null;
  money: { listed: DemoMoney; paid: DemoMoney; notCharged: DemoMoney } | null;
  reason: string | null;
}

export interface DemoStage {
  stage: string;
  status: string;
  code?: string | null;
  detail?: string | null;
}

export interface DemoCompensation {
  appliedAmount: string;
  agentAmount: string;
  platformAmount: string;
  asset: string;
  decimals: number;
  executionSignature: string;
  executedAt: string;
}

/** `null` when this deployment has no demo configured, so the route 404s. */
export async function runDemo(side: "pass" | "fail", query: string): Promise<DemoRunResult | null> {
  try {
    return await api.post<DemoRunResult>("/public/demo/run", { side, query });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function pollDemoVerdict(intentId: string): Promise<DemoVerdict> {
  return api.get<DemoVerdict>(`/public/demo/verdict/${intentId}`);
}

/**
 * Whether this deployment runs the demo at all, and the pinned slash if any.
 *
 * The backend mounts `/public/demo/*` only when a demo credential is
 * provisioned, and `GET /public/features` says whether it did, so the route is
 * never called where it does not exist. A 200 `null` means "demo, no slash
 * pinned" (the strip then does not render). Asking before the visitor presses
 * Run is what keeps the page from offering a button that cannot work.
 */
export async function getDemoStatus(): Promise<{
  configured: boolean;
  compensation: DemoCompensation | null;
}> {
  if (!(await getPublicFeatures()).demo) return { configured: false, compensation: null };
  const compensation = await api.get<DemoCompensation | null>("/public/demo/compensation");
  return { configured: true, compensation: compensation ?? null };
}

/**
 * Which of the design's three check lines a stage belongs to.
 *
 * The design names them `Response shape`, `Result quality rules` and
 * `Relevance judgement`; the engine emits `SCHEMA`, `DETERMINISTIC_RULES`,
 * `CROSS_CHECK` and `SEMANTIC`. Measured on a real call, the last two both come
 * back `NOT_APPLICABLE / stage_not_declared`.
 */
export const DEMO_STAGE_LABELS: Record<string, string> = {
  SCHEMA: "Response shape",
  DETERMINISTIC_RULES: "Result quality rules",
  SEMANTIC: "Relevance check",
};
