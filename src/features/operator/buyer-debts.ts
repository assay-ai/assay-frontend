import type { Money } from "@/interfaces/api";
import type { OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import type {
  BuyerDebtAssetTotal,
  BuyerDebtSkipReason,
  BuyerDebtSort,
  BuyerDebtVoidRecord,
  ListBuyerDebtsQuery,
  OperatorBuyerDebt,
} from "@/services/operator-buyer-debts.service";
import { formatMoney } from "@/utils/money";

import { operatorErrorSentence } from "./operator-errors";

/**
 * Buyer debts, the rules behind `/operator/buyer-debts`, kept out of the page
 * so they can be tested: who reads and who voids, the filters as a query,
 * the one-asset selection, and every sentence about a void.
 *
 * A void (`M-1`) releases the hold and the buyer is not charged; the provider
 * is not paid for those calls; it cannot be undone. Every void needs a second
 * operator, whatever the amount.
 */

/**
 * Who may read the list (the controller's `@RequireRoles`): only the roles
 * that may act on it, since it names every buyer's paying wallet.
 */
export const BUYER_DEBT_READ_ROLES: readonly OperatorRole[] = ["TRE", "ADJL"];
/** Who may request a void, and who may approve one (`M-1`). */
export const BUYER_DEBT_VOID_ROLES: readonly OperatorRole[] = ["ADJL", "TRE"];

/** The register code of a bulk void. */
export const BUYER_DEBT_VOID_CODE = "M-1";
/** The approval's action. */
export const BUYER_DEBT_VOID_ACTION = "buyer_debt.bulk_void";

/** The most ids one void request carries (the API refuses more). */
export const VOID_MAX_IDS = 100;
export const VOID_REASON_MIN = 10;
export const VOID_REASON_MAX = 2048;
export const VOID_TICKET_MAX = 128;
/** The page size: the API's maximum. */
export const DEBT_PAGE_SIZE = 100;

export const BUYER_DEBTS_HREF = "/operator/buyer-debts";

function holds(roles: readonly OperatorRole[], allowed: readonly OperatorRole[]): boolean {
  return roles.some((role) => allowed.includes(role));
}

export function mayReadBuyerDebts(roles: readonly OperatorRole[]): boolean {
  return holds(roles, BUYER_DEBT_READ_ROLES);
}

export function mayVoidBuyerDebts(roles: readonly OperatorRole[]): boolean {
  return holds(roles, BUYER_DEBT_VOID_ROLES);
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface DebtFilters {
  sort: BuyerDebtSort;
  order: "asc" | "desc";
  /** `YYYY-MM-DD`, a UTC day; empty for open. */
  from: string;
  to: string;
  chainId: string;
  assetId: string;
  payerAccount: string;
  buyerOrganizationId: string;
  providerId: string;
  lastError: string;
  suggestedOnly: boolean;
}

export const EMPTY_DEBT_FILTERS: DebtFilters = {
  sort: "lapsedAt",
  order: "desc",
  from: "",
  to: "",
  chainId: "",
  assetId: "",
  payerAccount: "",
  buyerOrganizationId: "",
  providerId: "",
  lastError: "",
  suggestedOnly: false,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filter fields the API would refuse as typed, with why. Pure. */
export function filterErrors(filters: DebtFilters): Partial<Record<keyof DebtFilters, string>> {
  const errors: Partial<Record<keyof DebtFilters, string>> = {};
  for (const key of ["buyerOrganizationId", "providerId"] as const) {
    const value = filters[key].trim();
    if (value && !UUID.test(value)) errors[key] = "A full id, like 7b2acf05-2b3e-4c1d-9f00-1a2b3c4d5e6f.";
  }
  for (const key of ["from", "to"] as const) {
    if (filters[key] && !DAY.test(filters[key])) errors[key] = "A date, YYYY-MM-DD.";
  }
  if (!errors.from && !errors.to && filters.from && filters.to && filters.from > filters.to) errors.to = "On or after the start.";
  return errors;
}

/**
 * The filters as the list's query. `to` is the whole UTC day: up to the start
 * of the next one. Fields with an error are left out (the bar shows the
 * error). Pure.
 */
export function debtQuery(filters: DebtFilters, cursor?: string, limit = DEBT_PAGE_SIZE): ListBuyerDebtsQuery {
  const errors = filterErrors(filters);
  const text = (key: keyof DebtFilters) => {
    const value = String(filters[key]).trim();
    return value && !errors[key] ? value : undefined;
  };
  const from = text("from");
  const to = text("to");
  return {
    cursor,
    limit,
    sort: filters.sort,
    order: filters.order,
    from: from ? `${from}T00:00:00.000Z` : undefined,
    to: to ? new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString() : undefined,
    chainId: text("chainId"),
    assetId: text("assetId"),
    payerAccount: text("payerAccount"),
    buyerOrganizationId: text("buyerOrganizationId"),
    providerId: text("providerId"),
    lastError: text("lastError"),
    suggestedOnly: filters.suggestedOnly || undefined,
  };
}

/** How many filters are set, besides the sort. */
export function activeFilterCount(filters: DebtFilters): number {
  const keys: (keyof DebtFilters)[] = ["from", "to", "chainId", "assetId", "payerAccount", "buyerOrganizationId", "providerId", "lastError"];
  return keys.filter((key) => String(filters[key]).trim() !== "").length + (filters.suggestedOnly ? 1 : 0);
}

// ── Money ───────────────────────────────────────────────────────────────────

export function debtMoney(row: Pick<OperatorBuyerDebt, "amount" | "assetId" | "decimals">): Money {
  return { amount: row.amount, asset: row.assetId, decimals: row.decimals };
}

/** A per-call amount, to the cent or finer: "$0.0125". */
export function debtAmountText(row: Pick<OperatorBuyerDebt, "amount" | "assetId" | "decimals">): string {
  return formatMoney(debtMoney(row), { decimals: 4 });
}

/** "12 debts · $3.40" for one asset's total. */
export function totalText(total: Pick<BuyerDebtAssetTotal, "count" | "amount" | "assetId" | "decimals">): string {
  return `${countText(total.count)} · ${formatMoney({ amount: total.amount, asset: total.assetId, decimals: total.decimals }, { decimals: 4 })}`;
}

export function countText(count: number): string {
  return `${count.toLocaleString("en-US")} debt${count === 1 ? "" : "s"}`;
}

/** The asset's token, short: `eip155:46630/erc20:0x915E…03ec` → `0x915E…03ec`. */
export function assetShort(assetId: string): string {
  const token = assetId.split(":").pop() ?? assetId;
  return token.length > 14 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token;
}

// ── Selection: one asset ────────────────────────────────────────────────────

export interface DebtSelection {
  /** Selected intent ids, in the order they were picked. */
  readonly ids: readonly string[];
  /** The one asset every selected debt is in; null while nothing is selected. */
  readonly assetId: string | null;
  readonly decimals: number | null;
  /** The sum of the selected amounts, atomic. */
  readonly amount: string;
}

export const EMPTY_SELECTION: DebtSelection = { ids: [], assetId: null, decimals: null, amount: "0" };

type Row = Pick<OperatorBuyerDebt, "intentId" | "assetId" | "decimals" | "amount">;

/** Why this row cannot join the selection, or null when it can. Pure. */
export function selectBlockedBecause(selection: DebtSelection, row: Row): string | null {
  if (selection.ids.includes(row.intentId)) return null;
  if (selection.assetId !== null && (selection.assetId !== row.assetId || selection.decimals !== row.decimals)) {
    return `One void covers one asset. These are in ${assetShort(selection.assetId)}; clear the selection to pick another asset.`;
  }
  if (selection.ids.length >= VOID_MAX_IDS) return `One void covers at most ${VOID_MAX_IDS} debts.`;
  return null;
}

function rebuild(rows: readonly Row[]): DebtSelection {
  if (rows.length === 0) return EMPTY_SELECTION;
  const amount = rows.reduce((sum, row) => sum + BigInt(row.amount), 0n);
  return { ids: rows.map((row) => row.intentId), assetId: rows[0]!.assetId, decimals: rows[0]!.decimals, amount: amount.toString() };
}

/**
 * Adds or removes rows, keeping the selection to one asset and 100 ids: a
 * row of another asset, or past the 100th, is left out. `known` maps every
 * id seen so far to its row, so a removal can recompute the total. Pure.
 */
export function toggleRows(selection: DebtSelection, rows: readonly Row[], on: boolean, known: ReadonlyMap<string, Row>): DebtSelection {
  if (!on) {
    const drop = new Set(rows.map((row) => row.intentId));
    return rebuild(selection.ids.filter((id) => !drop.has(id)).map((id) => known.get(id)!).filter(Boolean));
  }
  let next = selection;
  const picked = selection.ids.map((id) => known.get(id)!).filter(Boolean);
  for (const row of rows) {
    if (next.ids.includes(row.intentId) || selectBlockedBecause(next, row) !== null) continue;
    picked.push(row);
    next = rebuild(picked);
  }
  return next;
}

/**
 * "3 of 12 debts selected": the selection against the debts of its asset the
 * filters match, when that count is known and larger. Pure.
 */
export function selectedText(count: number, matching: number | null): string {
  if (matching === null || matching <= count) return `${countText(count)} selected`;
  return `${count.toLocaleString("en-US")} of ${countText(matching)} selected`;
}

/** The note beside "Select all matching" when the filters match more than one request carries; null otherwise. */
export function selectAllCapNote(matching: number): string | null {
  return matching > VOID_MAX_IDS
    ? `${VOID_MAX_IDS.toLocaleString("en-US")} of ${matching.toLocaleString("en-US")} selected; at most ${VOID_MAX_IDS} per request. The first ${VOID_MAX_IDS} in this order are picked.`
    : null;
}

/** How many debts of this asset the filters match, from the totals; null when unknown. */
export function matchingCountFor(byAsset: readonly BuyerDebtAssetTotal[] | undefined, assetId: string | null, decimals: number | null): number | null {
  if (!byAsset || assetId === null) return null;
  return byAsset.find((total) => total.assetId === assetId && total.decimals === decimals)?.count ?? null;
}

/** The selection's total as money; null when empty. */
export function selectionMoney(selection: DebtSelection): Money | null {
  if (selection.assetId === null || selection.decimals === null) return null;
  return { amount: selection.amount, asset: selection.assetId, decimals: selection.decimals };
}

/**
 * The header checkbox: the rows shown that can be selected now (those of the
 * selection's asset, else the first row's asset), and whether all of them
 * already are. Pure.
 */
export function pageSelectState<T extends Row>(selection: DebtSelection, rows: readonly T[]): { selectable: T[]; all: boolean; some: boolean } {
  const asset = selection.assetId ?? rows[0]?.assetId ?? null;
  const decimals = selection.decimals ?? rows[0]?.decimals ?? null;
  const selectable = rows.filter((row) => row.assetId === asset && row.decimals === decimals);
  const chosen = selectable.filter((row) => selection.ids.includes(row.intentId)).length;
  return { selectable, all: selectable.length > 0 && chosen === selectable.length, some: chosen > 0 && chosen < selectable.length };
}

/** "Select all matching" is offered when the filters match exactly one asset. */
export function matchingAsset(byAsset: readonly BuyerDebtAssetTotal[]): BuyerDebtAssetTotal | null {
  return byAsset.length === 1 ? byAsset[0]! : null;
}

// ── Who the selection is about ──────────────────────────────────────────────

type BreakdownRow = Pick<OperatorBuyerDebt, "intentId" | "buyerOrganizationId" | "payerAccount" | "providerId" | "amount">;

export interface DebtBuyerGroup {
  buyerOrganizationId: string;
  /** The paying wallets of these debts, distinct, in the order seen. */
  payers: string[];
  count: number;
  /** Atomic. */
  amount: string;
}

export interface DebtProviderGroup {
  /** Null: the debt names no provider. */
  providerId: string | null;
  count: number;
  amount: string;
}

/**
 * The debts per buyer (organization, with its paying wallets) and per
 * provider, largest amount first, so the requester and the approver see who
 * a void lets off and who goes unpaid. Pure.
 */
export function debtBreakdown(rows: readonly BreakdownRow[]): { buyers: DebtBuyerGroup[]; providers: DebtProviderGroup[] } {
  const buyers = new Map<string, { payers: string[]; count: number; amount: bigint }>();
  const providers = new Map<string | null, { count: number; amount: bigint }>();
  for (const row of rows) {
    const buyer = buyers.get(row.buyerOrganizationId) ?? { payers: [], count: 0, amount: 0n };
    if (!buyer.payers.includes(row.payerAccount)) buyer.payers.push(row.payerAccount);
    buyer.count += 1;
    buyer.amount += BigInt(row.amount);
    buyers.set(row.buyerOrganizationId, buyer);
    const provider = providers.get(row.providerId) ?? { count: 0, amount: 0n };
    provider.count += 1;
    provider.amount += BigInt(row.amount);
    providers.set(row.providerId, provider);
  }
  const byAmount = (a: { amount: bigint; count: number }, b: { amount: bigint; count: number }) =>
    a.amount === b.amount ? b.count - a.count : a.amount > b.amount ? -1 : 1;
  return {
    buyers: [...buyers.entries()]
      .map(([buyerOrganizationId, group]) => ({ buyerOrganizationId, ...group }))
      .sort(byAmount)
      .map((group) => ({ ...group, amount: group.amount.toString() })),
    providers: [...providers.entries()]
      .map(([providerId, group]) => ({ providerId, ...group }))
      .sort(byAmount)
      .map((group) => ({ ...group, amount: group.amount.toString() })),
  };
}

/** The selected debts whose recorded cause does not suggest the platform: likely the buyer's own doing. Pure. */
export function buyerCausedCount(rows: readonly Pick<OperatorBuyerDebt, "suggestedPlatformCause">[]): number {
  return rows.filter((row) => !row.suggestedPlatformCause).length;
}

export const BUYER_CAUSED_WARNING =
  "Some selected debts look caused by the buyer, not the platform. Voiding them means the provider is never paid.";

/** The most list pages the approver's breakdown reads to find the pinned ids (100 a page). */
export const PINNED_LOOKUP_MAX_PAGES = 20;

// ── The request ─────────────────────────────────────────────────────────────

export function reasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length < VOID_REASON_MIN) return `At least ${VOID_REASON_MIN} characters: what failed on the platform's side, and how you checked.`;
  if (length > VOID_REASON_MAX) return `At most ${VOID_REASON_MAX} characters.`;
  return null;
}

/** What a void does, for the request sheet and the approver's confirm. Lines, no full stops. */
export const VOID_CONSEQUENCES = {
  buyer: "The buyer is not charged for these calls, and its paid calls are no longer refused for them",
  provider: "The provider is not paid for these calls",
  hold: "The hold on the buyer's escrow is released",
  final: "It cannot be undone",
  when: "Use it only for debts the platform caused, such as the redeemer running out of gas",
  two: "A second operator (Treasury or Lead adjudicator, not you) has to approve it",
} as const;

/**
 * A refused void request: the ids that are not open debts (from
 * `error.context.intentIds`) and one sentence. Pure.
 */
export function voidRequestError(error: unknown): { message: string; invalidIds: string[] } {
  if (error instanceof ApiError && error.code === "OPERATOR_DEBT_VOID_INVALID") {
    const raw = error.context?.intentIds;
    const invalidIds = Array.isArray(raw) ? raw.map(String) : [];
    if (invalidIds.length > 0) {
      return {
        message: `${invalidIds.length === 1 ? "1 selected debt is" : `${invalidIds.length} selected debts are`} no longer open: settled, voided or replaced since the list loaded. They are marked below; leave them out and send again.`,
        invalidIds,
      };
    }
    return { message: "One void covers debts of one asset only. Split the selection by asset and send each.", invalidIds: [] };
  }
  if (error instanceof ApiError && error.status === 403) {
    if (error.code === "OPERATOR_AUTHORITY_EXCEEDED") {
      return { message: "The total is above your authority limit. An operator with a higher limit has to ask for it.", invalidIds: [] };
    }
    return { message: "Your roles do not allow asking for a void. Treasury or a Lead adjudicator can.", invalidIds: [] };
  }
  return { message: operatorErrorSentence(error), invalidIds: [] };
}

// ── The approved result ─────────────────────────────────────────────────────

export const SKIP_REASON_TEXT: Readonly<Record<BuyerDebtSkipReason, string>> = {
  NOT_A_DEBT: "No longer a debt: settled, replaced or voided since",
  SEQ_USED_ON_CHAIN: "Its voucher was used on chain, so it is not void",
  CHAIN_UNREADABLE: "The chain could not be read; ask again later",
  CHANGED_UNDERNEATH: "It changed while the void ran; check it and ask again",
  NOT_ATTEMPTED: "Not attempted: the run stopped before it; it is still owed",
};

export function skipReasonText(reason: BuyerDebtSkipReason | null): string {
  return reason ? (SKIP_REASON_TEXT[reason] ?? reason) : "Skipped";
}

/**
 * A bulk void's outcome, from the approve answer or the record kept on the
 * approval, or null when it is not one. The approve answer has no skipped
 * side: it is worked out from the requested and voided totals, and the run is
 * complete unless an item was never attempted. Pure.
 */
export function debtVoidResultOf(action: string, result: unknown): BuyerDebtVoidRecord | null {
  if (action !== BUYER_DEBT_VOID_ACTION || !result || typeof result !== "object") return null;
  const r = result as Partial<BuyerDebtVoidRecord>;
  if (typeof r.voidedCount !== "number" || typeof r.requestedCount !== "number" || !Array.isArray(r.items)) return null;
  const requested = /^[0-9]+$/.test(String(r.requestedAmount)) ? BigInt(String(r.requestedAmount)) : 0n;
  const voided = /^[0-9]+$/.test(String(r.voidedAmount)) ? BigInt(String(r.voidedAmount)) : 0n;
  return {
    ...(r as BuyerDebtVoidRecord),
    skippedCount: typeof r.skippedCount === "number" ? r.skippedCount : r.requestedCount - r.voidedCount,
    skippedAmount: typeof r.skippedAmount === "string" ? r.skippedAmount : (requested > voided ? requested - voided : 0n).toString(),
    complete: typeof r.complete === "boolean" ? r.complete : !r.items.some((item) => item.skipReason === "NOT_ATTEMPTED"),
    recordedAt: typeof r.recordedAt === "string" ? r.recordedAt : null,
  };
}

function debtsWord(count: number): string {
  return countText(count).replace(/debts?$/, "buyer $&");
}

/** "Voided 48 of 50 buyer debts ($4.80 of $5.00). 2 skipped ($0.20)." Pure. */
export function debtVoidSummary(result: Pick<BuyerDebtVoidRecord, "assetId" | "decimals" | "requestedCount" | "requestedAmount" | "voidedCount" | "voidedAmount" | "skippedCount" | "skippedAmount">): string {
  const money = (amount: string) => formatMoney({ amount, asset: result.assetId, decimals: result.decimals }, { decimals: 4 });
  const head =
    result.skippedCount === 0
      ? `Voided ${debtsWord(result.voidedCount)} (${money(result.voidedAmount)}).`
      : `Voided ${result.voidedCount} of ${debtsWord(result.requestedCount)} (${money(result.voidedAmount)} of ${money(result.requestedAmount)}). ${result.skippedCount} skipped (${money(result.skippedAmount)}).`;
  return result.voidedCount === 0 ? `${head} Nothing was voided; the buyers still owe them.` : `${head} The providers are not paid for the voided ones.`;
}

/** The notice of a partial run: some debts were never attempted and are still owed. */
export function partialRunText(result: Pick<BuyerDebtVoidRecord, "items">): string {
  const left = result.items.filter((item) => item.skipReason === "NOT_ATTEMPTED").length;
  return `Partial run: the void stopped before it finished${left > 0 ? `, and ${debtsWord(left)} ${left === 1 ? "was" : "were"} never attempted` : ""}. Those are still owed; check them and request a new void if needed.`;
}

/** The outcome on one line, for an approval's row: "0 voided · 1 skipped · partial run". Pure. */
export function debtVoidShort(result: Pick<BuyerDebtVoidRecord, "voidedCount" | "skippedCount" | "complete">): string {
  return `${result.voidedCount} voided · ${result.skippedCount} skipped${result.complete ? "" : " · partial run"}`;
}
