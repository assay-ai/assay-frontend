/**
 * Transactions this browser sent and has not yet seen through, kept in
 * localStorage so a reload (or a closed tab) does not lose them.
 *
 * `SignAction` remembers a submitted hash only while it is mounted; this is the
 * part that survives. A screen calls `track()` the moment a step reports
 * "submitted" and `resolve()` once it is confirmed; on the next load the
 * pending list shows the entry with its explorer link and picks it up again
 * (a deposit is credited, a claim is confirmed).
 *
 * Pure helpers here; the React hook is `usePendingTransactions`.
 */

export type PendingTxKind = "deposit" | "claim";

export interface PendingTx {
  /** Stable per action, e.g. `deposit:<depositId>`; tracking the same id replaces it. */
  id: string;
  kind: PendingTxKind;
  /** What the person did, in their words: "Deposit $20.00". */
  label: string;
  /** CAIP-2. */
  chainId: string;
  hash: string;
  explorerUrl?: string;
  submittedAt: number;
  /** What is needed to finish the job after a reload (e.g. the deposit to credit). */
  resume?: { depositId: string; amountAtomic: string };
}

export const PENDING_TX_STORAGE_KEY = "assay.pending-transactions.v1";
/** After a day an entry is either done or needs a person, not a spinner. */
export const PENDING_TX_MAX_AGE_MS = 24 * 3600 * 1000;

function isPendingTx(value: unknown): value is PendingTx {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.kind === "deposit" || v.kind === "claim") &&
    typeof v.label === "string" &&
    typeof v.chainId === "string" &&
    typeof v.hash === "string" &&
    typeof v.submittedAt === "number"
  );
}

/** Parses what storage held; anything malformed or too old is dropped. */
export function parsePending(raw: string | null, nowMs: number = Date.now()): PendingTx[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingTx).filter((tx) => nowMs - tx.submittedAt < PENDING_TX_MAX_AGE_MS);
  } catch {
    return [];
  }
}

export function withPending(list: readonly PendingTx[], tx: PendingTx): PendingTx[] {
  return [...list.filter((item) => item.id !== tx.id), tx];
}

export function withoutPending(list: readonly PendingTx[], id: string): PendingTx[] {
  return list.filter((item) => item.id !== id);
}
