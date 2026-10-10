"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { History, Info, Pause, Pencil, Plus, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles, PanelDescription } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { policyBootstrapAsset, type PolicyBootstrapAsset } from "@/features/limits/policy-bootstrap";
import { useChains } from "@/hooks/useChains";
import type { Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { listAgents } from "@/services/account.service";
import {
  listSpendPolicyHistory,
  getSpendPolicyTyped,
  updateSpendPolicy,
  type SpendPolicy,
  type UpdateSpendPolicyBody,
} from "@/services/limits.service";
import { getReceiptsSummary } from "@/services/receipts.service";
import { cn } from "@/utils";
import { formatMoney, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

import { KeyValueRow, PageHeader, StatusPill } from "./chrome";
import {
  formatLimit,
  monthBounds,
  percentOf,
  relativeTime,
  timestamp,
  todayBounds,
} from "./format";

/**
 * Limits and velocity.
 *
 * The screen is organised by Foundations rule 04 — **stop, tell and ask are
 * three different regions**. A limit refuses a call, an alert blocks nothing,
 * an approval holds the call for a human. Merging any two of them into one
 * control is the bug that rule exists to prevent.
 *
 * This screen redraws where that boundary has to sit. The original layout put
 * STOP and TELL side by side in one flex row as visual equals — same panel
 * chrome, same width, same row — which reads as "these are the same kind of
 * control" even though their subtitles say otherwise. STOP and ASK (both of
 * which really do gate a call, one refusing, one — once approvals exist —
 * holding) now stack full-width above a visually distinct ALERTS band: a
 * labelled divider, a dashed/tinted panel instead of the solid one every
 * limit panel uses, and copy that states outright that nothing in that band
 * can refuse a call. The 50/80/100% checkboxes stay read-only for a reason
 * that has nothing to do with layout — see below — but the layout change is
 * what stops them from *reading* like a ceiling.
 *
 * What is real and what is not, on the wire (re-check before trusting this
 * list after the next backend change):
 *
 *  - **STOP** reads `GET /spend-policy`'s six ceilings — `perCallMax`,
 *    `dailyCap`, `monthlyCap`, `maxCallsPerHour`, `maxCallsPerMinute`
 *    and `maxSpendPerHour` — plus `allowedTools`, which is not a number but is still a real stop:
 *    `SpendPolicyEnforcementService`'s pre-flight gate checks the allowlist
 *    *before* any cap, right after `paused`. `null` is "every tool", `[]` is
 *    "no tool" — a second, narrower kill switch that is not `paused` and
 *    must not be confused with it.
 *  - **Live usage comes from the policy's own `usage` block, not
 *    from `GET /receipts/summary`**, wherever it is present. The point of
 *    `usage.spendToday` / `usage.spendThisMonth` is that they are computed by
 *    the exact same `SpendUsageService` call the enforcement gate itself
 *    checks a call against — the number on this screen and the number a call
 *    was actually refused against can never disagree, which was not
 *    previously true of a value borrowed from a different endpoint.
 *    `GET /receipts/summary` is kept only as a fallback for the case where
 *    `usage` itself is missing from the response (`SpendPolicyService.get()`
 *    swallows a usage-computation failure to `undefined` rather than
 *    5xx-ing). `usage.spendThisHour` / `callsThisMinute` / `callsThisHour`
 *    have **no other source at all** — when `usage.usageReadable` is `false`
 *    (Redis could not be read) those three meters are omitted outright, the
 *    same instinct the receipts fallback already had for its own outage:
 *    absent, never drawn at zero.
 *  - **ASK** reads `requireApprovalAbove` from the same policy, but this
 *    section only *stores* a number. There is no `AWAITING_APPROVAL` intent
 *    state anywhere in the backend yet, no producer of
 *    `POLICY_APPROVAL_TIMEOUT`, and grepping the running backend for either
 *    string returns nothing outside this DTO's own doc comment. The panel
 *    says so explicitly instead of describing a 30-minute timeout that does
 *    not exist.
 *  - **"Pause all paid calls"** writes `PATCH /spend-policy { paused }`.
 *  - **Editing.** `PATCH /spend-policy` now also writes the six STOP
 *    ceilings, `allowedTools` and `requireApprovalAbove` from a sheet on this
 *    screen (previously only `paused` was writable here). Every write sends
 *    `changeReason`; an untouched field is omitted from the body rather than
 *    resent, so "left untouched" and "cleared" (an explicit JSON `null`)
 *    stay distinguishable — verified against the running API: an omitted
 *    key kept the previous version's value, an explicit `null` cleared it.
 *  - **Creating.** With no policy (404 `SPEND_POLICY_NOT_FOUND`) the same
 *    sheet writes version 1 through the same `PATCH`, diffed against "no
 *    ceiling anywhere" and carrying `assetId`/`decimals` — a first version
 *    has nothing to inherit them from. They are the settlement asset of the
 *    agent's chain on `GET /chains` (`policyBootstrapAsset`), never a literal.
 *  - **TELL has no per-user-editable resource for the bands themselves.**
 *    `notification_preferences` is keyed on `(event, channel)`, not on a
 *    50/80/100% band, and `SPEND_THRESHOLD_CROSSED`'s bands
 *    (`SPEND_ALERT_BANDS`) live in the event's own dedupe key
 *    (`${agentId}:${scope}:${band}`) in the producer, not in any row a
 *    PATCH could change. So the three checkboxes below stay read-only,
 *    reproducing the design's fixed state. What **is** now real and *not*
 *    reproduced here is the channel/mute choice: `notification-channels` and
 *    `notification-preferences` are live resources and are edited on
 *    **`/alerts`**, not here — this screen links
 *    there instead of duplicating a control it does not own.
 *
 * The design's own claim that enforcement happens at the key-holding party
 * rather than in this software is gone from this file: the signer
 * infrastructure that claim depended on does not exist yet. What is
 * actually true, and still worth a banner: every ceiling here is checked by
 * `SpendPolicyEnforcementService`'s pre-flight gate on the gateway, before a
 * call is ever priced or a hold is placed — i.e. in this backend, not by a
 * piece of separate client-side or embedded-wallet infrastructure that would
 * keep enforcing even if the backend were compromised. That is a real,
 * narrower claim than the one it replaces, not a restatement of it with
 * softer words.
 */

interface SummaryTotals {
  chargedTotal?: Money;
  calls?: number;
}

function summaryCharged(summary: unknown): Money | null {
  const totals = (summary as { totals?: SummaryTotals } | undefined)?.totals;
  return totals?.chargedTotal ?? null;
}

/** Same shape as `percentOf` (`format.ts`) but for the two count-based ceilings, which are not `Money`. */
function percentOfCount(used: number | null | undefined, cap: number | null | undefined): number | null {
  if (used == null || cap == null || cap <= 0) return null;
  return Math.min(100, Math.max(0, (used / cap) * 100));
}

/**
 * Fold a `PATCH /spend-policy` response back into the `["spend-policy"]` cache
 * WITHOUT losing the live-usage block.
 *
 * `SpendPolicyService` attaches `usage` in `get()` only — `patch()` returns the
 * new version with no `usage` key at all (verified: `usageFor` is called from
 * one place). Writing the PATCH response straight into the cache therefore
 * deleted every meter on the screen and silently dropped the day/month figures
 * back onto the `GET /receipts/summary` fallback, which counts a different
 * thing: immediately after a save the screen read "$0.00 today" while the
 * enforcement counters said $1.25. Carrying the previous `usage` forward keeps
 * the new ceilings and the old (still-correct) consumption together for the
 * one render before the refetch lands.
 */
function writeBackPolicy(client: QueryClient, next: SpendPolicy): void {
  client.setQueryData<SpendPolicy | null>(["spend-policy"], (previous) =>
    next.usage === undefined && previous?.usage ? { ...next, usage: previous.usage } : next
  );
  void client.invalidateQueries({ queryKey: ["spend-policy"] });
}

/**
 * What a create diffs against: no ceiling anywhere. Every field the buyer
 * leaves blank on a first policy is therefore omitted from the body, and the
 * backend's own default for an omitted field on a first version is `null` too.
 */
const NO_POLICY: Pick<
  SpendPolicy,
  | "perCallMax"
  | "dailyCap"
  | "monthlyCap"
  | "maxSpendPerHour"
  | "requireApprovalAbove"
  | "maxCallsPerMinute"
  | "maxCallsPerHour"
  | "allowedTools"
> = {
  perCallMax: null,
  dailyCap: null,
  monthlyCap: null,
  maxSpendPerHour: null,
  requireApprovalAbove: null,
  maxCallsPerMinute: null,
  maxCallsPerHour: null,
  allowedTools: null,
};

function LimitRow({
  label,
  value,
  percent,
  tone = "warning",
}: {
  label: string;
  value: string;
  percent?: number | null;
  tone?: "warning" | "primary";
}) {
  return (
    <div className="flex w-full flex-col gap-[7px]">
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-body-13 text-01">{label}</span>
        <span className="font-mono text-mono-sm font-semibold text-01">{value}</span>
      </div>
      {percent != null ? (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden rounded-full bg-03"
        >
          <div
            className={cn("h-1.5 rounded-full", tone === "warning" ? "bg-warning-500" : "bg-primary-500")}
            style={{ width: `${percent}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The alert rows. `readOnly` throughout, and for a reason that has nothing to
 * do with this screen's own write path: there is no band-level resource on
 * the wire at all (see the header comment) — these mirror the design's fixed
 * state and cannot be saved no matter what else on this screen becomes
 * editable.
 */
const DAILY_THRESHOLDS = [
  { label: "50%", checked: false },
  { label: "80%", checked: true },
  { label: "100%", checked: true },
];
const MONTHLY_THRESHOLDS = [
  { label: "50%", checked: true },
  { label: "80%", checked: true },
  { label: "100%", checked: true },
];

/** `"all"` = `null` on the wire, `"none"` = `[]`, `"list"` = a real array. Three states, not two. */
type AllowedToolsMode = "all" | "list" | "none";

function allowedToolsModeOf(allowedTools: string[] | null): AllowedToolsMode {
  if (allowedTools === null) return "all";
  if (allowedTools.length === 0) return "none";
  return "list";
}

/** Comma- or newline-separated tool ids -> a deduplicated, order-preserving list. */
function parseToolsList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const id = raw.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Parses a money field's text against `decimals`. `""` means "clear the ceiling" (→ `null`). */
function parseMoneyField(
  text: string,
  decimals: number
): { value: string | null; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null };
  let parsed: Decimal;
  try {
    parsed = new Decimal(trimmed);
  } catch {
    return { value: null, error: "Not a number" };
  }
  if (parsed.isNegative()) return { value: null, error: "Cannot be negative" };
  const atomic = parsed.mul(new Decimal(10).pow(decimals));
  if (!atomic.isInteger()) {
    return { value: null, error: `At most ${decimals} decimal place${decimals === 1 ? "" : "s"} for this asset` };
  }
  return { value: atomic.toFixed(0) };
}

/** Same idea for the two integer ceilings. `""` means "clear" (→ `null`). */
function parseIntField(text: string): { value: number | null; error?: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: "Whole number only" };
  const n = Number(trimmed);
  if (n <= 0) return { value: null, error: "Must be positive" };
  return { value: n };
}

/** `undefined` = omit the key (unchanged); otherwise the new value, including an explicit `null`. */
function diffMoney(parsed: string | null, current: Money | null): string | null | undefined {
  const currentAtomic = current?.amount ?? null;
  return parsed === currentAtomic ? undefined : parsed;
}

function diffInt(parsed: number | null, current: number | null): number | null | undefined {
  return parsed === current ? undefined : parsed;
}

function diffAllowedTools(
  mode: AllowedToolsMode,
  text: string,
  current: string[] | null
): string[] | null | undefined {
  const desired = mode === "all" ? null : mode === "none" ? [] : parseToolsList(text);
  const same = JSON.stringify(desired) === JSON.stringify(current ?? null);
  return same ? undefined : desired;
}

export function LimitsView() {
  const queryClient = useQueryClient();

  const policyQuery = useQuery({
    queryKey: ["spend-policy"],
    retry: false,
    queryFn: async (): Promise<SpendPolicy | null> => {
      try {
        return await getSpendPolicyTyped();
      } catch (error) {
        if (error instanceof ApiError && error.code === "SPEND_POLICY_NOT_FOUND") return null;
        throw error;
      }
    },
  });

  const historyQuery = useQuery({
    queryKey: ["spend-policy-history"],
    // One retry, not the default three: a panel that spins for eight seconds
    // before admitting it failed reads as a hang, not as an outage.
    retry: false,
    queryFn: () => listSpendPolicyHistory({ limit: 8 }),
  });

  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: () => listAgents({ limit: 50 }) });
  const { chains } = useChains();

  const day = React.useMemo(() => todayBounds(), []);
  const month = React.useMemo(() => monthBounds(), []);

  const policy = policyQuery.data ?? null;
  const usage = policy?.usage;
  /*
    Only consulted while no policy exists: a first PATCH must name
    `assetId`/`decimals` (`SPEND_POLICY_ASSET_REQUIRED` otherwise), and they
    come from the agent's chain's settlement asset on `GET /chains`.
  */
  const bootstrap: PolicyBootstrapAsset = agentsQuery.isError
    ? { kind: "unknown", reason: "the agents on this account could not be read" }
    : policyBootstrapAsset(agentsQuery.data?.items, chains);
  // See the header comment: `usage.spendToday`/`spendThisMonth` are the
  // enforcement-side figures and are preferred whenever the policy carries a
  // `usage` block. `GET /receipts/summary` runs unconditionally (a query, not
  // a side effect) but is read only as a fallback for the block being absent.
  const todaySpend = useQuery({
    queryKey: ["receipts-summary", "day", day.from],
    enabled: !usage,
    // `groupBy` is REQUIRED by the running API (400 VALIDATION_FAILED without
    // it) even though the OpenAPI document marks it optional. Only the totals
    // are used here.
    queryFn: () => getReceiptsSummary({ from: day.from, to: day.to, groupBy: "tool" }),
  });
  const monthSpend = useQuery({
    queryKey: ["receipts-summary", "month", month.from],
    enabled: !usage,
    queryFn: () => getReceiptsSummary({ from: month.from, to: month.to, groupBy: "tool" }),
  });

  const usingUsageBlock = Boolean(usage);
  const chargedToday = usage ? usage.spendToday : summaryCharged(todaySpend.data);
  const chargedMonth = usage ? usage.spendThisMonth : summaryCharged(monthSpend.data);
  const velocityReadable = usage?.usageReadable === true;

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) =>
      updateSpendPolicy({ paused, changeReason: paused ? "Paused from Limits" : "Resumed from Limits" }),
    onSuccess: (next) => {
      writeBackPolicy(queryClient, next);
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
      toast.success(next.paused ? "All paid calls are paused" : "Paid calls resumed");
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "The change could not be saved");
    },
  });

  const editMutation = useMutation({
    mutationFn: (body: UpdateSpendPolicyBody) => updateSpendPolicy(body),
    onSuccess: (next) => {
      writeBackPolicy(queryClient, next);
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
      toast.success(
        next.policyVersion === 1 ? "Policy created as v1" : `Saved as policy v${next.policyVersion}`
      );
      setEditOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "The change could not be saved");
    },
  });

  // ── Edit sheet state ──────────────────────────────────────────────────────
  const [editOpen, setEditOpen] = React.useState(false);
  const [perCallMaxText, setPerCallMaxText] = React.useState("");
  const [dailyCapText, setDailyCapText] = React.useState("");
  const [monthlyCapText, setMonthlyCapText] = React.useState("");
  const [maxCallsPerMinuteText, setMaxCallsPerMinuteText] = React.useState("");
  const [maxCallsPerHourText, setMaxCallsPerHourText] = React.useState("");
  const [maxSpendPerHourText, setMaxSpendPerHourText] = React.useState("");
  const [requireApprovalAboveText, setRequireApprovalAboveText] = React.useState("");
  const [allowedToolsMode, setAllowedToolsMode] = React.useState<AllowedToolsMode>("all");
  const [allowedToolsText, setAllowedToolsText] = React.useState("");
  const [changeReason, setChangeReason] = React.useState("");
  const [formErrors, setFormErrors] = React.useState<Record<string, string>>({});

  function openEdit() {
    if (!policy) {
      if (bootstrap.kind !== "ready") return;
      // Create: every field blank, i.e. no ceiling until the buyer types one.
      setPerCallMaxText("");
      setDailyCapText("");
      setMonthlyCapText("");
      setMaxCallsPerMinuteText("");
      setMaxCallsPerHourText("");
      setMaxSpendPerHourText("");
      setRequireApprovalAboveText("");
      setAllowedToolsMode("all");
      setAllowedToolsText("");
      setChangeReason("");
      setFormErrors({});
      setEditOpen(true);
      return;
    }
    setPerCallMaxText(policy.perCallMax ? toDecimal(policy.perCallMax).toString() : "");
    setDailyCapText(policy.dailyCap ? toDecimal(policy.dailyCap).toString() : "");
    setMonthlyCapText(policy.monthlyCap ? toDecimal(policy.monthlyCap).toString() : "");
    setMaxCallsPerMinuteText(policy.maxCallsPerMinute == null ? "" : String(policy.maxCallsPerMinute));
    setMaxCallsPerHourText(policy.maxCallsPerHour == null ? "" : String(policy.maxCallsPerHour));
    setMaxSpendPerHourText(policy.maxSpendPerHour ? toDecimal(policy.maxSpendPerHour).toString() : "");
    setRequireApprovalAboveText(
      policy.requireApprovalAbove ? toDecimal(policy.requireApprovalAbove).toString() : ""
    );
    setAllowedToolsMode(allowedToolsModeOf(policy.allowedTools));
    setAllowedToolsText(policy.allowedTools && policy.allowedTools.length > 0 ? policy.allowedTools.join("\n") : "");
    setChangeReason("");
    setFormErrors({});
    setEditOpen(true);
  }

  function handleSave() {
    if (!policy && bootstrap.kind !== "ready") return;
    const creating = !policy;
    const base = policy ?? NO_POLICY;
    const decimals = policy ? policy.decimals : bootstrap.kind === "ready" ? bootstrap.decimals : 0;

    const perCallMax = parseMoneyField(perCallMaxText, decimals);
    const dailyCap = parseMoneyField(dailyCapText, decimals);
    const monthlyCap = parseMoneyField(monthlyCapText, decimals);
    const maxSpendPerHour = parseMoneyField(maxSpendPerHourText, decimals);
    const requireApprovalAbove = parseMoneyField(requireApprovalAboveText, decimals);
    const maxCallsPerMinute = parseIntField(maxCallsPerMinuteText);
    const maxCallsPerHour = parseIntField(maxCallsPerHourText);

    const errors: Record<string, string> = {};
    if (perCallMax.error) errors.perCallMax = perCallMax.error;
    if (dailyCap.error) errors.dailyCap = dailyCap.error;
    if (monthlyCap.error) errors.monthlyCap = monthlyCap.error;
    if (maxSpendPerHour.error) errors.maxSpendPerHour = maxSpendPerHour.error;
    if (requireApprovalAbove.error) errors.requireApprovalAbove = requireApprovalAbove.error;
    if (maxCallsPerMinute.error) errors.maxCallsPerMinute = maxCallsPerMinute.error;
    if (maxCallsPerHour.error) errors.maxCallsPerHour = maxCallsPerHour.error;

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    const body: UpdateSpendPolicyBody = {
      changeReason: changeReason.trim() || (creating ? "Created from Limits" : "Updated from Limits"),
    };

    const perCallMaxPatch = diffMoney(perCallMax.value, base.perCallMax);
    if (perCallMaxPatch !== undefined) body.perCallMax = perCallMaxPatch;
    const dailyCapPatch = diffMoney(dailyCap.value, base.dailyCap);
    if (dailyCapPatch !== undefined) body.dailyCap = dailyCapPatch;
    const monthlyCapPatch = diffMoney(monthlyCap.value, base.monthlyCap);
    if (monthlyCapPatch !== undefined) body.monthlyCap = monthlyCapPatch;
    const maxSpendPerHourPatch = diffMoney(maxSpendPerHour.value, base.maxSpendPerHour);
    if (maxSpendPerHourPatch !== undefined) body.maxSpendPerHour = maxSpendPerHourPatch;
    const requireApprovalAbovePatch = diffMoney(requireApprovalAbove.value, base.requireApprovalAbove);
    if (requireApprovalAbovePatch !== undefined) body.requireApprovalAbove = requireApprovalAbovePatch;

    const maxCallsPerMinutePatch = diffInt(maxCallsPerMinute.value, base.maxCallsPerMinute);
    if (maxCallsPerMinutePatch !== undefined) body.maxCallsPerMinute = maxCallsPerMinutePatch;
    const maxCallsPerHourPatch = diffInt(maxCallsPerHour.value, base.maxCallsPerHour);
    if (maxCallsPerHourPatch !== undefined) body.maxCallsPerHour = maxCallsPerHourPatch;

    const allowedToolsPatch = diffAllowedTools(allowedToolsMode, allowedToolsText, base.allowedTools);
    if (allowedToolsPatch !== undefined) body.allowedTools = allowedToolsPatch;

    const changedKeys = Object.keys(body).filter((key) => key !== "changeReason");
    if (changedKeys.length === 0) {
      toast.info(
        creating ? "Set at least one limit to create a policy" : "Nothing changed — no PATCH was sent"
      );
      return;
    }

    // A first version has nothing to inherit the asset from; see `policyBootstrapAsset`.
    if (creating && bootstrap.kind === "ready") {
      body.assetId = bootstrap.assetId;
      body.decimals = bootstrap.decimals;
    }

    editMutation.mutate(body);
  }

  const agentLabel = React.useMemo(() => {
    if (!policy?.agentId) return null;
    const match = agentsQuery.data?.items.find((agent) => agent.agentId === policy.agentId);
    return (match?.label as string | undefined) ?? null;
  }, [agentsQuery.data, policy?.agentId]);

  const title = agentLabel ? `Limits and policy — ${agentLabel}` : "Limits and policy";

  const subtitle = policy
    ? `Policy v${policy.policyVersion} · changed ${relativeTime(
        policy.createdAt
      )} · changes apply immediately and are recorded with a reason`
    : "changes apply immediately and are recorded with a reason";

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              icon={<History />}
              asChild={false}
              type="button"
              onClick={() =>
                document
                  .getElementById("limits-change-history")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            >
              Change history
            </Button>
            {policy ? (
              <Button variant="secondary" icon={<Pencil />} type="button" onClick={openEdit}>
                Edit limits
              </Button>
            ) : null}
            {!policy && policyQuery.isSuccess ? (
              <Button
                icon={<Plus />}
                type="button"
                disabled={bootstrap.kind !== "ready"}
                onClick={openEdit}
              >
                Create policy
              </Button>
            ) : null}
            {policy ? (
              <Button
                variant="danger"
                icon={<Pause />}
                type="button"
                loading={pauseMutation.isPending}
                onClick={() => pauseMutation.mutate(!policy.paused)}
              >
                {policy.paused ? "Resume paid calls" : "Pause all paid calls"}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-3.5 tablet:p-[15px]">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary-600" />
        <p className="text-body-13 text-primary-700">
          Every ceiling below is checked by the payment gateway before a call is priced or a hold is
          placed. There is no separate embedded-wallet enforcement layer in this product yet, so a
          bug in our software can defeat these — they are a control, not a guarantee. What is true
          today is narrower and still real: a call cannot spend past what is written here without
          going through this backend&rsquo;s own pre-flight check first.
        </p>
      </div>

      {/*
        One sentence, one link — the other half of this distinction lives on
        `/funding/escrow/limits`, which is a SEPARATE screen on
        purpose: the note above already says a compromised backend can defeat
        everything here, and the escrow limits are the one place that is not
        true.
      */}
      <p className="text-body-xs text-03">
        This is convenience, not your only defence — the two limits on your{" "}
        <Link href="/funding/escrow/limits" className="font-semibold text-primary-600 underline">
          on-chain escrow
        </Link>{" "}
        are enforced by the settlement program itself and can be raised by nobody but your wallet,
        including us.
      </p>

      {policy?.paused ? (
        <div className="flex w-full items-center gap-2.5 rounded-lg border border-danger-20 bg-danger-10 p-3.5">
          <Pause aria-hidden="true" className="size-[15px] shrink-0 text-danger-600" />
          <p className="text-body-13 text-danger-700">
            Every paid call is paused at this scope. Free calls are unaffected.
          </p>
        </div>
      ) : null}

      {policyQuery.isPending ? (
        <p className="font-mono text-mono-13 text-03">Loading the policy…</p>
      ) : policyQuery.isError ? (
        <EmptyState
          icon={<ShieldCheck width={22} height={22} />}
          title="The policy could not be read"
          description={`${
            policyQuery.error instanceof ApiError
              ? policyQuery.error.message
              : "The request could not be completed"
          }. Nothing here is a statement about what your agent may spend — a limit that cannot be read is not the same as a limit that does not exist.`}
        />
      ) : !policy ? (
        <div className="flex w-full flex-col items-start gap-3">
          <EmptyState
            icon={<ShieldCheck width={22} height={22} />}
            title="No policy has been written yet"
            description="Until a spend policy exists, nothing here refuses a call. Create one to set a per-call ceiling, daily and monthly caps, velocity limits and an approval threshold."
          />
          <p data-testid="policy-bootstrap-note" className="text-body-xs text-03">
            {bootstrap.kind === "ready"
              ? `Amounts are in ${bootstrap.symbol} on ${bootstrap.chainName}, the asset your agent settles in.`
              : bootstrap.kind === "reading"
                ? "Reading which asset your agent settles in…"
                : `A policy cannot be created here yet: ${bootstrap.reason}.`}
          </p>
          <Button
            icon={<Plus />}
            type="button"
            disabled={bootstrap.kind !== "ready"}
            onClick={openEdit}
          >
            Create policy
          </Button>
        </div>
      ) : (
        <>
          <div className="flex w-full flex-col gap-4">
            {/* STOP — the call is refused */}
            <Panel>
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>STOP — the call is refused</PanelTitle>
                  <PanelDescription className="whitespace-normal">
                    checked by the gateway's pre-flight gate before a call is priced
                  </PanelDescription>
                </PanelTitles>
                <StatusPill label="STOP" tone="danger" />
              </PanelHeader>
              <PanelBody className="gap-4 p-5">
                <LimitRow label="Per call" value={formatLimit(policy.perCallMax)} />
                <LimitRow
                  label="Per day"
                  value={formatLimit(policy.dailyCap)}
                  percent={percentOf(chargedToday, policy.dailyCap)}
                  tone="warning"
                />
                <LimitRow
                  label="Per month"
                  value={formatLimit(policy.monthlyCap)}
                  percent={percentOf(chargedMonth, policy.monthlyCap)}
                  tone="primary"
                />
                <LimitRow
                  label="Calls per minute"
                  value={policy.maxCallsPerMinute == null ? "unlimited" : String(policy.maxCallsPerMinute)}
                  percent={velocityReadable ? percentOfCount(usage!.callsThisMinute, policy.maxCallsPerMinute) : null}
                />
                <LimitRow
                  label="Calls per hour"
                  value={policy.maxCallsPerHour == null ? "unlimited" : String(policy.maxCallsPerHour)}
                  percent={velocityReadable ? percentOfCount(usage!.callsThisHour, policy.maxCallsPerHour) : null}
                />
                <LimitRow
                  label="Spend per hour"
                  value={formatLimit(policy.maxSpendPerHour)}
                  percent={
                    velocityReadable && usage?.spendThisHour
                      ? percentOf(usage.spendThisHour, policy.maxSpendPerHour)
                      : null
                  }
                />
                <LimitRow
                  label="Tools allowed"
                  value={
                    policy.allowedTools === null
                      ? "every tool"
                      : policy.allowedTools.length === 0
                        ? "no tool"
                        : `${policy.allowedTools.length} listed`
                  }
                />
                {policy.allowedTools !== null && policy.allowedTools.length === 0 ? (
                  <p className="flex items-start gap-1.5 text-body-xs text-danger-600">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                    No tool may be called under this policy — a stop distinct from Pause: Pause
                    stops every call, this stops calls by tool.
                  </p>
                ) : policy.allowedTools !== null ? (
                  <p className="break-all text-body-xs text-03">{policy.allowedTools.join(", ")}</p>
                ) : null}

                {!usingUsageBlock && (todaySpend.isError || monthSpend.isError) ? (
                  <p className="text-body-xs text-danger-600">
                    Spend against these caps could not be read, so the meters are absent rather
                    than drawn at zero.
                  </p>
                ) : usingUsageBlock && !velocityReadable ? (
                  <p className="text-body-xs text-danger-600">
                    The per-minute, per-hour and spend-per-hour counters could not be read from
                    Redis just now, so those three meters are blank rather than a wrong zero.
                  </p>
                ) : chargedToday ? (
                  <p className="text-body-xs text-03">
                    {formatMoney(chargedToday, { decimals: 2 })} charged so far today ·{" "}
                    {formatMoney(chargedMonth, { decimals: 2 })} this month
                    {usingUsageBlock ? " — the same figures the gateway checks a call against" : ""}. Resets 00:00 UTC.
                  </p>
                ) : null}
              </PanelBody>
            </Panel>

            {/* ASK — refused until approvals exist */}
            <Panel>
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>ASK — refused until approvals exist</PanelTitle>
                  <PanelDescription className="whitespace-normal">
                    a call above this amount is refused, because nobody can approve it yet
                  </PanelDescription>
                </PanelTitles>
                <StatusPill label="REFUSES ABOVE" tone="warning" />
              </PanelHeader>
              <PanelBody className="px-5 pb-4 pt-2">
                <KeyValueRow
                  label="Approval required above"
                  value={
                    policy.requireApprovalAbove
                      ? formatLimit(policy.requireApprovalAbove)
                      : "no call requires approval"
                  }
                />
                <div className="flex items-start gap-2 pt-2.5">
                  <Info aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
                  <p className="text-body-xs text-03">
                    There is no approval flow yet — no <code>AWAITING_APPROVAL</code> state and no
                    approval link — so a call priced above this amount is refused with{" "}
                    <code>MCP_APPROVAL_REQUIRED</code> instead of being held for a human. An approval
                    nobody can give resolves to deny, never allow. Raise or clear the value to let
                    such calls through.
                  </p>
                </div>
              </PanelBody>
            </Panel>
          </div>

          {/* Section boundary — deliberately not another Panel row next to STOP/ASK. See header comment. */}
          <div className="flex w-full items-center gap-3 pt-1">
            <span className="whitespace-nowrap font-mono text-mono-2xs text-03">
              ALERTS — REFUSE NOTHING
            </span>
            <div className="h-px w-full flex-1 bg-02" aria-hidden="true" />
          </div>

          {/* TELL — nothing is blocked */}
          <Panel className="border-dashed bg-02">
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>TELL — nothing is blocked</PanelTitle>
                <PanelDescription className="whitespace-normal">
                  a notification, never a refusal — collapsing this into a limit is the exact bug
                  Foundations rule 04 exists to prevent
                </PanelDescription>
              </PanelTitles>
              <StatusPill label="TELL" tone="warning" />
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <p className="text-body-xs text-03">
                The bands below are fixed by the <code>SPEND_THRESHOLD_CROSSED</code>{" "}
                event definition, not by a per-user setting — there is no row anywhere that stores
                &ldquo;80%&rdquo;, only the producer&rsquo;s own dedupe key. They are drawn
                disabled because they are reference, not a control. The design also draws a
                &ldquo;First use of a new tool&rdquo; alert; no such event exists in the
                catalogue and nothing can emit one, so a checked box for it would promise an
                alert that can never arrive — the row is omitted rather than faked.
              </p>
              <div className="flex flex-wrap items-center gap-[18px]">
                <span className="text-body-13 text-01">Daily at</span>
                {DAILY_THRESHOLDS.map((item) => (
                  <Checkbox key={item.label} label={item.label} checked={item.checked} disabled readOnly />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-[18px]">
                <span className="text-body-13 text-01">Monthly at</span>
                {MONTHLY_THRESHOLDS.map((item) => (
                  <Checkbox key={item.label} label={item.label} checked={item.checked} disabled readOnly />
                ))}
              </div>
              <Checkbox label="Velocity anomaly (velocity.anomaly)" checked disabled readOnly />
              <div className="flex flex-col gap-1">
                <Checkbox label="Refund on a single call (payment_intent.refunded)" checked={false} disabled readOnly />
                <p className="text-body-xs text-03">
                  rolls into the daily digest — 4.5M events/month delivered raw trains you to
                  ignore us
                </p>
              </div>
              <p className="text-body-13 text-02">
                Choosing where these are delivered (email, push, Slack, webhook) and muting an
                event is a real, saved setting now — just not on this screen. Saving a destination
                is not the same as being reachable at it: no vendor is wired behind any channel
                yet, so today every one of these lands in the in-app inbox and nowhere else.{" "}
                <Link href="/alerts" className="font-semibold text-primary-600 underline">
                  Manage channels on Alerts →
                </Link>
              </p>
            </PanelBody>
          </Panel>
        </>
      )}

      {/* Change history */}
      <Panel id="limits-change-history">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Change history</PanelTitle>
            <PanelDescription>every write is audited with an actor</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-2.5 px-5 pb-[18px] pt-3.5">
          {historyQuery.isPending ? (
            <p className="font-mono text-mono-13 text-03">Loading…</p>
          ) : historyQuery.isError ? (
            <p className="text-body-13 text-danger-600">
              The change history could not be read.
            </p>
          ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-body-13 text-02">
              No policy version has been written yet, so there is nothing to audit.
            </p>
          ) : (
            historyQuery.data?.items.map((entry) => (
              <div key={entry.id} className="flex flex-wrap items-center gap-3.5">
                <span className="font-mono text-mono-12 font-semibold text-01">
                  v{entry.policyVersion}
                </span>
                <span className="font-mono text-mono-12 text-03">{timestamp(entry.changedAt)}</span>
                <span className="font-mono text-mono-12 text-03">{entry.changedBy ?? "system"}</span>
                <span className="font-mono text-mono-12 text-02">
                  {entry.changeReason ?? "policy written"}
                </span>
              </div>
            ))
          )}
        </PanelBody>
      </Panel>

      {/* Edit limits — writes the STOP ceilings, the ASK threshold and `allowedTools`. */}
      <Sheet open={editOpen} onOpenChange={setEditOpen}>
        <SheetContent className="tablet:max-w-[560px]">
          <SheetHeader>
            <SheetTitle>{policy ? "Edit limits" : "Create policy"}</SheetTitle>
            <SheetDescription>
              {policy
                ? "Leave a field as shown to keep its current value. Clear a field to remove that " +
                  "ceiling entirely (unlimited) — the two are different PATCH bodies under the hood, and " +
                  "this form sends only the fields you actually touch."
                : `Fill in the limits you want; a blank field means no ceiling. Amounts are in ${
                    bootstrap.kind === "ready" ? bootstrap.symbol : "your settlement asset"
                  }. This writes version 1 of your policy.`}
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
            <Field
              label="Per call"
              id="edit-per-call-max"
              placeholder="unlimited"
              suffix="max"
              value={perCallMaxText}
              onChange={(event) => setPerCallMaxText(event.target.value)}
              error={formErrors.perCallMax}
            />
            <Field
              label="Per day"
              id="edit-daily-cap"
              placeholder="unlimited"
              suffix="cap"
              value={dailyCapText}
              onChange={(event) => setDailyCapText(event.target.value)}
              error={formErrors.dailyCap}
            />
            <Field
              label="Per month"
              id="edit-monthly-cap"
              placeholder="unlimited"
              suffix="cap"
              value={monthlyCapText}
              onChange={(event) => setMonthlyCapText(event.target.value)}
              error={formErrors.monthlyCap}
            />
            <Field
              label="Calls per minute"
              id="edit-calls-per-minute"
              placeholder="unlimited"
              suffix="calls/min"
              inputMode="numeric"
              value={maxCallsPerMinuteText}
              onChange={(event) => setMaxCallsPerMinuteText(event.target.value)}
              error={formErrors.maxCallsPerMinute}
              hint="the resolution a retry loop actually lives at — refused attempts count too"
            />
            <Field
              label="Calls per hour"
              id="edit-calls-per-hour"
              placeholder="unlimited"
              suffix="calls/hr"
              inputMode="numeric"
              value={maxCallsPerHourText}
              onChange={(event) => setMaxCallsPerHourText(event.target.value)}
              error={formErrors.maxCallsPerHour}
            />
            <Field
              label="Spend per hour"
              id="edit-spend-per-hour"
              placeholder="unlimited"
              suffix="per hour"
              value={maxSpendPerHourText}
              onChange={(event) => setMaxSpendPerHourText(event.target.value)}
              error={formErrors.maxSpendPerHour}
              hint="the money half of velocity — a cheap call repeated fast still breaches this"
            />
            <Field
              label="Approval required above"
              id="edit-approval-above"
              placeholder="never"
              suffix="ASK threshold"
              value={requireApprovalAboveText}
              onChange={(event) => setRequireApprovalAboveText(event.target.value)}
              error={formErrors.requireApprovalAbove}
              hint="stored only — see the ASK panel; nothing enforces this yet"
            />

            <div className="flex w-full flex-col gap-1.5">
              <span className="text-label-13 text-01">Tools allowed</span>
              <Segmented value={allowedToolsMode} onValueChange={(v) => setAllowedToolsMode(v as AllowedToolsMode)}>
                <SegmentedItem value="all">Every tool</SegmentedItem>
                <SegmentedItem value="list">Only listed</SegmentedItem>
                <SegmentedItem value="none">No tool</SegmentedItem>
              </Segmented>
              {allowedToolsMode === "list" ? (
                <Textarea
                  aria-label="Allowed tool ids"
                  placeholder={
                    "one tool id per line, e.g.\n06399979-f8b8-4c9e-a9b1-bd2a5924d442"
                  }
                  value={allowedToolsText}
                  onChange={(event) => setAllowedToolsText(event.target.value)}
                />
              ) : null}
              {allowedToolsMode === "none" ? (
                <p className="flex items-start gap-1.5 text-body-xs text-danger-600">
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                  This is not the same as Pause: Pause stops every call, this stops every tool call
                  specifically (an empty allowlist), and the two can be set independently.
                </p>
              ) : (
                <p className="text-body-xs text-03">
                  {allowedToolsMode === "all"
                    ? "null on the wire — every tool is allowed"
                    : "an explicit array on the wire — only these tool ids may be called. The " +
                      "gateway matches the tool's id, a UUID, not its name; copy it from Tools. A " +
                      "name typed here matches nothing, which refuses every call."}
                </p>
              )}
            </div>

            <Field
              label="Reason for this change"
              id="edit-change-reason"
              placeholder="Updated from Limits"
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
              hint="recorded on the version this creates and shown in Change history below"
            />
          </div>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={editMutation.isPending} onClick={handleSave}>
              {policy ? "Save changes" : "Create policy"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
