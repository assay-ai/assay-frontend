import type { CursorPage, ListQuery, Money } from "@/interfaces";

import { api } from "./api";

/**
 * Typed additions to the spend-policy surface.
 *
 * `getSpendPolicy()` already lives in `account.service.ts` but returns
 * `unknown`. The Limits screen needs typed reads, the history feed and the
 * write path, so the typed shapes and the two extra calls live here.
 *
 * Read against the running API, not the OpenAPI document: `GET /spend-policy`
 * answers **404 `SPEND_POLICY_NOT_FOUND`** when the organization has never
 * written one — it does not answer an empty object. That is the state a fresh
 * account is in, so it is the state the Limits screen renders first.
 *
 * The policy carries three velocity/scope ceilings
 * (`maxCallsPerMinute`, `maxSpendPerHour`, `allowedTools`) and a `usage`
 * block (live consumption against every ceiling, read from the same
 * counters `SpendPolicyEnforcementService` checks a call against before
 * charging it). All four are on `SpendPolicyDto` / `SpendPolicyHistoryEntryDto`
 * / `UpdateSpendPolicyDto` in the running backend; see
 * `spend-policy/dto/get-spend-policy.dto.ts` and
 * `spend-policy/dto/update-spend-policy.dto.ts`.
 */

/**
 * `SpendPolicyUsageDto` — live consumption next to each
 * ceiling. `spendToday`/`spendThisMonth` come from `payment_intents` (the
 * same figures `SpendUsageService` computes); `spendThisHour`,
 * `callsThisMinute` and `callsThisHour` come from the Redis velocity
 * counters and are `null` whenever `usageReadable` is `false` — Redis could
 * not be read, so the three are absent rather than a wrong zero. This whole
 * block is itself optional on `SpendPolicy.usage`: `SpendPolicyService.get()`
 * omits it entirely if computing it throws, rather than failing the read.
 */
export interface SpendPolicyUsage {
  spendToday: Money;
  spendThisMonth: Money;
  spendThisHour: Money | null;
  callsThisMinute: number | null;
  callsThisHour: number | null;
  usageReadable: boolean;
}

/** `SpendPolicyDto`. Every money field is nullable: `null` = no ceiling. */
export interface SpendPolicy {
  id: string;
  scope: "ORGANIZATION" | "AGENT";
  agentId: string | null;
  policyVersion: number;
  asset: string;
  decimals: number;
  perCallMax: Money | null;
  dailyCap: Money | null;
  monthlyCap: Money | null;
  maxCallsPerHour: number | null;
  /** The resolution a retry loop actually lives at. `null` = unlimited. */
  maxCallsPerMinute: number | null;
  /** Money per hour, the other half of velocity. `null` = unlimited. */
  maxSpendPerHour: Money | null;
  /**
   * `null` = every tool is allowed. `[]` = **no** tool is
   * allowed — a stop distinct from `paused` (that stops every call; this
   * stops calls by tool).
   */
  allowedTools: string[] | null;
  requireApprovalAbove: Money | null;
  /** The kill switch, distinct from a zeroed cap. */
  paused: boolean;
  changedBy: string | null;
  changeReason: string | null;
  createdAt: string;
  /** Omitted, not `null`, when it could not be computed. */
  usage?: SpendPolicyUsage;
}

/** `SpendPolicyHistoryEntryDto`. `supersededAt` is null on exactly one row. */
export interface SpendPolicyHistoryEntry {
  id: string;
  scope: "ORGANIZATION" | "AGENT";
  agentId: string | null;
  policyVersion: number;
  perCallMax: Money | null;
  dailyCap: Money | null;
  monthlyCap: Money | null;
  maxCallsPerHour: number | null;
  
  maxCallsPerMinute: number | null;
  
  maxSpendPerHour: Money | null;
  
  allowedTools: string[] | null;
  requireApprovalAbove: Money | null;
  paused: boolean;
  changedBy: string | null;
  changeReason: string | null;
  changedAt: string;
  supersededAt: string | null;
}

/**
 * `UpdateSpendPolicyDto`. Amounts are ATOMIC units as strings, never numbers.
 *
 * Every field is `T | null | undefined`, deliberately not collapsed to
 * `T | undefined`: an **omitted** key keeps the previous version's value, an
 * explicit JSON **`null`** clears the limit. Both are real and distinct on
 * the wire (verified against the running API — see the report for this
 * change), so a caller building this body must be able to express "the user
 * did not touch this field" separately from "the user cleared it".
 */
export interface UpdateSpendPolicyBody {
  assetId?: string;
  decimals?: number;
  perCallMax?: string | null;
  dailyCap?: string | null;
  monthlyCap?: string | null;
  maxCallsPerHour?: number | null;
  /** `null` removes the per-minute velocity limit. */
  maxCallsPerMinute?: number | null;
  /** Atomic units. `null` removes the spend-per-hour velocity limit. */
  maxSpendPerHour?: string | null;
  /**
   * `null` allows every tool; `[]` allows none. An
   * explicit `null` on a later PATCH clears a narrower list back to "every
   * tool".
   */
  allowedTools?: string[] | null;
  requireApprovalAbove?: string | null;
  paused?: boolean;
  changeReason?: string;
  changedBy?: string;
}

/** GET /spend-policy — typed. Throws `ApiError` with code `SPEND_POLICY_NOT_FOUND`. */
export function getSpendPolicyTyped(): Promise<SpendPolicy> {
  return api.get<SpendPolicy>("/spend-policy");
}

/** GET /spend-policy/history — newest first. */
export function listSpendPolicyHistory(
  query: ListQuery = {}
): Promise<CursorPage<SpendPolicyHistoryEntry>> {
  return api.get<CursorPage<SpendPolicyHistoryEntry>>(
    "/spend-policy/history",
    query as Record<string, unknown>
  );
}

/**
 * PATCH /spend-policy — append-only; every write is a new version.
 *
 * The design's "Pause all paid calls" is exactly `{ paused: true }`: `paused`
 * is a distinct field from a zeroed cap, because a zeroed cap is a limit the
 * agent is told about and a pause is the account being switched off.
 *
 * Writing targets the calling session's own agent scope, never the
 * organization default (`SpendPolicyService.patch`'s class doc) — the first
 * write for an agent that has never had its own policy starts a brand-new
 * version chain with no ceilings inherited from the org default except the
 * asset/decimals pairing. Verified directly against the running API while
 * building this file: see the report.
 */
export function updateSpendPolicy(body: UpdateSpendPolicyBody): Promise<SpendPolicy> {
  return api.patch<SpendPolicy>("/spend-policy", body);
}
