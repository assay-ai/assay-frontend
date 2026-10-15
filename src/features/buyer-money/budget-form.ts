import type { Money } from "@/interfaces";
import type { SpendPolicy, UpdateSpendPolicyBody } from "@/services/limits.service";
import { parseAmountInput, toDecimal } from "@/utils/money";

/**
 * The Budgets form: three money fields by default, the rest under Advanced.
 * A blank field means "no limit". Only the fields that changed are sent, so a
 * PATCH never rewrites what the person did not touch.
 */
export interface BudgetForm {
  perCall: string;
  perDay: string;
  perMonth: string;
  callsPerMinute: string;
  callsPerHour: string;
  spendPerHour: string;
  toolsMode: "all" | "only" | "none";
  tools: string[];
  /** The older "refuse calls above" rule (approval threshold); `true` clears it. */
  clearRefuseAbove: boolean;
  reason: string;
}

export type BudgetField = "perCall" | "perDay" | "perMonth" | "callsPerMinute" | "callsPerHour" | "spendPerHour" | "tools";

export interface BudgetPreset {
  id: string;
  label: string;
  perCall: string;
  perDay: string;
  perMonth: string;
}

export const BUDGET_PRESETS: readonly BudgetPreset[] = [
  { id: "try", label: "Trying it out", perCall: "0.50", perDay: "5", perMonth: "50" },
  { id: "steady", label: "Steady use", perCall: "2", perDay: "25", perMonth: "300" },
];

type PolicyFields = Pick<
  SpendPolicy,
  "perCallMax" | "dailyCap" | "monthlyCap" | "maxCallsPerMinute" | "maxCallsPerHour" | "maxSpendPerHour" | "allowedTools" | "requireApprovalAbove"
>;

const NONE: PolicyFields = {
  perCallMax: null,
  dailyCap: null,
  monthlyCap: null,
  maxCallsPerMinute: null,
  maxCallsPerHour: null,
  maxSpendPerHour: null,
  allowedTools: null,
  requireApprovalAbove: null,
};

const major = (money: Money | null): string => (money ? toDecimal(money).toString() : "");

export function budgetFormFrom(policy: PolicyFields | null): BudgetForm {
  const p = policy ?? NONE;
  return {
    perCall: major(p.perCallMax),
    perDay: major(p.dailyCap),
    perMonth: major(p.monthlyCap),
    callsPerMinute: p.maxCallsPerMinute == null ? "" : String(p.maxCallsPerMinute),
    callsPerHour: p.maxCallsPerHour == null ? "" : String(p.maxCallsPerHour),
    spendPerHour: major(p.maxSpendPerHour),
    toolsMode: p.allowedTools === null ? "all" : p.allowedTools.length === 0 ? "none" : "only",
    tools: p.allowedTools ?? [],
    clearRefuseAbove: false,
    reason: "",
  };
}

function money(text: string, decimals: number): { atomic: string | null; error: string | null } {
  if (text.trim() === "") return { atomic: null, error: null };
  const parsed = parseAmountInput(text, { decimals });
  return { atomic: parsed.atomic, error: parsed.error };
}

function count(text: string): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, error: null };
  if (!/^\d+$/.test(t) || Number(t) <= 0) return { value: null, error: "Enter a whole number above zero." };
  return { value: Number(t), error: null };
}

export type BudgetResult =
  | { ok: true; body: UpdateSpendPolicyBody; changed: boolean }
  | { ok: false; errors: Partial<Record<BudgetField, string>> };

export function budgetPatch(form: BudgetForm, policy: PolicyFields | null, decimals: number, creating: boolean): BudgetResult {
  const base = policy ?? NONE;
  const perCall = money(form.perCall, decimals);
  const perDay = money(form.perDay, decimals);
  const perMonth = money(form.perMonth, decimals);
  const spendPerHour = money(form.spendPerHour, decimals);
  const perMinute = count(form.callsPerMinute);
  const perHour = count(form.callsPerHour);
  const errors: Partial<Record<BudgetField, string>> = {};
  if (perCall.error) errors.perCall = perCall.error;
  if (perDay.error) errors.perDay = perDay.error;
  if (perMonth.error) errors.perMonth = perMonth.error;
  if (spendPerHour.error) errors.spendPerHour = spendPerHour.error;
  if (perMinute.error) errors.callsPerMinute = perMinute.error;
  if (perHour.error) errors.callsPerHour = perHour.error;
  if (!errors.perCall && !errors.perDay && perCall.atomic && perDay.atomic && BigInt(perCall.atomic) > BigInt(perDay.atomic)) {
    errors.perCall = "One call cannot cost more than the whole day allows.";
  }
  if (!errors.perDay && !errors.perMonth && perDay.atomic && perMonth.atomic && BigInt(perDay.atomic) > BigInt(perMonth.atomic)) {
    errors.perDay = "A day cannot allow more than the whole month.";
  }
  if (form.toolsMode === "only" && form.tools.length === 0) errors.tools = "Pick at least one tool, or allow every tool.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: UpdateSpendPolicyBody = {};
  const diffMoney = (atomic: string | null, current: Money | null) => (atomic === (current?.amount ?? null) ? undefined : atomic);
  const set = <K extends keyof UpdateSpendPolicyBody>(key: K, value: UpdateSpendPolicyBody[K] | undefined) => {
    if (value !== undefined) body[key] = value;
  };
  set("perCallMax", diffMoney(perCall.atomic, base.perCallMax));
  set("dailyCap", diffMoney(perDay.atomic, base.dailyCap));
  set("monthlyCap", diffMoney(perMonth.atomic, base.monthlyCap));
  set("maxSpendPerHour", diffMoney(spendPerHour.atomic, base.maxSpendPerHour));
  set("maxCallsPerMinute", perMinute.value === base.maxCallsPerMinute ? undefined : perMinute.value);
  set("maxCallsPerHour", perHour.value === base.maxCallsPerHour ? undefined : perHour.value);
  const tools = form.toolsMode === "all" ? null : form.toolsMode === "none" ? [] : [...new Set(form.tools)];
  set("allowedTools", JSON.stringify(tools) === JSON.stringify(base.allowedTools) ? undefined : tools);
  if (form.clearRefuseAbove && base.requireApprovalAbove) body.requireApprovalAbove = null;

  const changed = Object.keys(body).length > 0;
  body.changeReason = form.reason.trim() || (creating ? "Budget created" : "Budget changed");
  return { ok: true, body, changed };
}

/** "agent:…" is how the API records a change made through an agent key; a person reads it as "An agent key". */
export function plainActor(changedBy: string | null | undefined): string {
  if (!changedBy) return "Assay";
  if (changedBy.startsWith("agent:")) return "An agent key";
  return changedBy;
}
