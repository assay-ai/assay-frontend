/**
 * The provider's stake and dispute transactions this browser sent and has not
 * seen through yet, kept in localStorage so a reload does not lose them (the
 * same idea as the buyer's `features/buyer-money/pending-tx.ts`, under its own
 * key so neither console lists the other's).
 *
 * The sheets wrap their wallet steps with `trackSubmissions`: a step that
 * reports "submitted" is remembered at once and forgotten when it confirms.
 * If the page reloads in between, `ProviderPendingTxList` shows it with its
 * explorer link and watches it to the end.
 */

import type { WalletStep } from "@/components/patterns/wallet-steps";

export type ProviderPendingKind = "stake" | "unstake" | "withdraw" | "dispute";

export interface ProviderPendingTx {
  /** Stable per action, e.g. `dispute:<requestId>:dispute`; tracking the same id replaces it. */
  id: string;
  kind: ProviderPendingKind;
  /** What the provider did, in their words: "Dispute the Weather now penalty". */
  label: string;
  /** CAIP-2. */
  chainId: string;
  hash: string;
  explorerUrl?: string;
  submittedAt: number;
}

export const PROVIDER_PENDING_TX_STORAGE_KEY = "assay.provider.pending-transactions.v1";
/** After a day an entry is either done or needs a person, not a spinner. */
export const PROVIDER_PENDING_TX_MAX_AGE_MS = 24 * 3600 * 1000;

const KINDS: readonly ProviderPendingKind[] = ["stake", "unstake", "withdraw", "dispute"];

function isProviderPendingTx(value: unknown): value is ProviderPendingTx {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    KINDS.includes(v.kind as ProviderPendingKind) &&
    typeof v.label === "string" &&
    typeof v.chainId === "string" &&
    typeof v.hash === "string" &&
    typeof v.submittedAt === "number"
  );
}

/** Parses what storage held; anything malformed or too old is dropped. */
export function parseProviderPending(raw: string | null, nowMs: number = Date.now()): ProviderPendingTx[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProviderPendingTx).filter((tx) => nowMs - tx.submittedAt < PROVIDER_PENDING_TX_MAX_AGE_MS);
  } catch {
    return [];
  }
}

export interface PendingTracker {
  track: (tx: ProviderPendingTx) => void;
  resolve: (id: string) => void;
  release: (id: string) => void;
}

/**
 * The same steps, remembered across a reload: the moment a step reports
 * "submitted" its hash is stored; once the step finishes (confirmed) it is
 * forgotten; if it throws after submitting, the page-level list takes it over.
 * Each step's own `run` is called unchanged, so every signing guard inside it
 * still applies.
 */
export function trackSubmissions(
  steps: readonly WalletStep[],
  input: { kind: ProviderPendingKind; chainId: string | null; label: (step: WalletStep) => string; idPrefix: string },
  tracker: PendingTracker,
  now: () => number = Date.now,
): WalletStep[] {
  return steps.map((step) => ({
    ...step,
    run: async (context) => {
      const id = `${input.idPrefix}:${step.id}`;
      let tracked = false;
      try {
        const result = await step.run({
          ...context,
          report: (report) => {
            if (report.stage === "submitted" && typeof report.data === "string" && input.chainId) {
              tracked = true;
              tracker.track({
                id,
                kind: input.kind,
                label: input.label(step),
                chainId: input.chainId,
                hash: report.data,
                explorerUrl: report.explorerUrl,
                submittedAt: now(),
              });
            }
            context.report(report);
          },
        });
        if (tracked) tracker.resolve(id);
        return result;
      } catch (error) {
        if (tracked) tracker.release(id);
        throw error;
      }
    },
  }));
}
