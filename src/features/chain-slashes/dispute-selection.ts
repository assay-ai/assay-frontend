import { refusedFunctionOf } from "@/features/chain-calls/refusals";
import { MAX_SLASH_BATCH } from "@/libs/chains/evm/stake-slashes/abi";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { ApiError } from "@/libs/ApiClient";
import { describeChainRefusal } from "@/libs/chains/status-labels";

/**
 * Which penalties the provider may select for "Dispute selected on chain",
 * and what the dispute's refusals say. Pure, so the page and the tests run
 * the same rules.
 *
 * The contract's own rule (`X402Stake._dispute`): the record is `Pending`, the
 * sender is its provider, and `block.timestamp < executableAt`. So a row is
 * selectable only when:
 *
 * - the page shows the signed-in provider's OWN stake wallet — a pasted
 *   address is read-only, and nobody else's wallet can sign for it;
 * - it is `Pending` (a `Disputed` row was already disputed; a record is
 *   disputed at most once, and an upheld one has its window closed);
 * - its window is still open, by its own `executableAt` — never a fixed 72 hours.
 *
 * At most {@link MAX_DISPUTE_SELECTION} (`MAX_SLASH_BATCH`, 64) at once.
 *
 * Neither a block on the account nor a paused contract changes any of this:
 * `disputeSlash` is neither pause- nor blocklist-gated, because it only
 * protects the provider.
 */

export const MAX_DISPUTE_SELECTION = MAX_SLASH_BATCH;

/** Why a row has no checkbox, or `null` when it may be selected. */
export type NotSelectableReason = "not-own-wallet" | "not-pending" | "window-closed";

export function notSelectableReason(
  row: ChainSlashRow,
  nowSeconds: number,
  viewingOwnStake: boolean,
): NotSelectableReason | null {
  if (!viewingOwnStake) return "not-own-wallet";
  if (row.status.key !== "pending") return "not-pending";
  if (nowSeconds >= row.executableAt) return "window-closed";
  return null;
}

export function isDisputeSelectable(
  row: ChainSlashRow,
  nowSeconds: number,
  viewingOwnStake: boolean,
): boolean {
  return notSelectableReason(row, nowSeconds, viewingOwnStake) === null;
}

export type ToggleResult =
  | { readonly ok: true; readonly selected: ReadonlySet<string> }
  | { readonly ok: false; readonly selected: ReadonlySet<string>; readonly reason: "limit" | "not-selectable" };

/**
 * Select or unselect one row. Unselecting always works; selecting refuses a
 * row that is not selectable, and a 65th.
 */
export function toggleDisputeSelection(
  selected: ReadonlySet<string>,
  row: ChainSlashRow,
  nowSeconds: number,
  viewingOwnStake: boolean,
): ToggleResult {
  const id = row.requestId.toLowerCase();
  if (selected.has(id)) {
    const next = new Set(selected);
    next.delete(id);
    return { ok: true, selected: next };
  }
  if (!isDisputeSelectable(row, nowSeconds, viewingOwnStake)) {
    return { ok: false, selected, reason: "not-selectable" };
  }
  if (selected.size >= MAX_DISPUTE_SELECTION) return { ok: false, selected, reason: "limit" };
  const next = new Set(selected);
  next.add(id);
  return { ok: true, selected: next };
}

/**
 * "Select all open": every selectable row in `rows` (already filtered and
 * sorted, soonest deadline first), up to the limit. Rows already selected stay.
 */
export function selectAllDisputable(
  selected: ReadonlySet<string>,
  rows: readonly ChainSlashRow[],
  nowSeconds: number,
  viewingOwnStake: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  for (const row of rows) {
    if (next.size >= MAX_DISPUTE_SELECTION) break;
    if (isDisputeSelectable(row, nowSeconds, viewingOwnStake)) next.add(row.requestId.toLowerCase());
  }
  return next;
}

/**
 * Drop what can no longer be disputed — a window that closed while the page
 * was open, a row that is now Disputed after a refetch, another address.
 * Returns the same set when nothing changed, so a React state update is a no-op.
 */
export function pruneDisputeSelection(
  selected: ReadonlySet<string>,
  rows: readonly ChainSlashRow[],
  nowSeconds: number,
  viewingOwnStake: boolean,
): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const byId = new Map(rows.map((row) => [row.requestId.toLowerCase(), row]));
  const next = new Set<string>();
  for (const id of selected) {
    const row = byId.get(id);
    if (row && isDisputeSelectable(row, nowSeconds, viewingOwnStake)) next.add(id);
  }
  return next.size === selected.size ? selected : next;
}

/**
 * A failed dispute, in words — everything but the per-row 422 refusals, which
 * the rows show themselves. `chainName` names the chain in the sentence.
 */
export function disputeErrorMessage(error: unknown, chainName: string): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "The dispute could not be prepared.";
  }
  switch (error.code) {
    case "SLASH_CHAIN_BATCH_REFUSED":
      return `Nothing was sent: the chain would refuse the whole ${refusedFunctionOf(error) ?? "batch"}. The penalties it would refuse are marked below; unselect them and try again.`;
    case "PROVIDER_STAKE_AUTHORITY_UNPROVEN":
      return `Assay has no proved stake wallet for you on ${chainName}, so it cannot name the wallet that disputes. Nothing was sent. Dispute from the case page, or contact Assay support.`;
    case "SLASH_CHAIN_UNAVAILABLE":
      return `The dispute transaction cannot be built right now: Assay cannot reach ${chainName}. Nothing was sent; try again in a moment.`;
    case "CHAIN_UNSUPPORTED":
      return `Assay does not support ${chainName} for on-chain disputes. Nothing was sent.`;
    case "CHAIN_PAYLOAD_MALFORMED":
    case "VALIDATION_FAILED":
    case "BAD_REQUEST":
      return `The request was not accepted: ${error.message}. Nothing was sent.`;
    case "NETWORK_ERROR":
      return "Assay could not be reached. Nothing was sent; check your connection and try again.";
    default:
      return `${describeChainRefusal(error)}. Nothing was sent.`;
  }
}
