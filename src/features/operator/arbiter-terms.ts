"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { ArbiterTerms } from "@/interfaces/operator";
import { operatorQueries } from "@/features/operator/queries";

/**
 * The chain's arbiter terms (`GET /operator/arbiter/terms`), under the same
 * query key the Arbiter page reads, so one read serves both pages. The last
 * successful read is also kept in this browser, so when the chain can't be
 * read the penalty view still draws the split "as read at <time>", instead of
 * nothing. Only the split falls back: the dispute window, which dates a
 * penalty's steps, is never taken from an old read.
 */

const KEY = "assay.operator.arbiter-terms.v1";

interface Kept {
  terms: Pick<ArbiterTerms, "slashAgentBps" | "slashPlatformBps">;
  readAt: number;
}

function readAll(): Record<string, Kept> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Kept>) : {};
  } catch {
    return {};
  }
}

/** A kept read older than this is not drawn: too old to stand for "the split". */
export const LAST_KNOWN_MAX_AGE_MS = 7 * 86_400_000;

/**
 * The last split read for a chain, or null: also null when the stored value is
 * out of range (a share is 1 to 10000 basis points), dated in the future, or
 * older than a week. Never throws.
 */
export function lastKnownSplit(chainId: string, now: number = Date.now()): Kept | null {
  const kept = readAll()[chainId];
  if (!kept || !Number.isFinite(kept.readAt)) return null;
  const bps = kept.terms?.slashAgentBps;
  if (!Number.isInteger(bps) || bps <= 0 || bps > 10_000) return null;
  if (kept.readAt > now || now - kept.readAt > LAST_KNOWN_MAX_AGE_MS) return null;
  return kept;
}

/** Keep a successful read. Never throws. */
export function rememberSplit(chainId: string, terms: Pick<ArbiterTerms, "slashAgentBps" | "slashPlatformBps">, readAt: number): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        ...readAll(),
        [chainId]: { terms: { slashAgentBps: terms.slashAgentBps, slashPlatformBps: terms.slashPlatformBps }, readAt },
      }),
    );
  } catch {
    // A private window: the split is simply not drawn when the chain can't be read.
  }
}

export interface SplitTerms {
  agentBps: number;
  /** The treasury's share (`slashPlatformBps`); `null` when the read did not carry it. */
  platformBps: number | null;
  /** When it was read (ms). */
  readAt: number;
  /** True when the chain could not be read now and this is the last read. */
  lastKnown: boolean;
}

/** The split to draw: the live read, else the last one kept, else null. Pure. */
export function splitTerms(
  live: { data?: Pick<ArbiterTerms, "slashAgentBps" | "slashPlatformBps">; dataUpdatedAt: number; isError: boolean },
  kept: Kept | null,
): SplitTerms | null {
  if (live.data) {
    return { agentBps: live.data.slashAgentBps, platformBps: live.data.slashPlatformBps ?? null, readAt: live.dataUpdatedAt, lastKnown: false };
  }
  if (live.isError && kept) {
    return { agentBps: kept.terms.slashAgentBps, platformBps: kept.terms.slashPlatformBps ?? null, readAt: kept.readAt, lastKnown: true };
  }
  return null;
}

export function useArbiterTerms(chainId: string | null) {
  const query = useQuery({
    ...operatorQueries.arbiterTerms(chainId ?? ""),
    enabled: chainId !== null,
  });
  React.useEffect(() => {
    if (chainId && query.data) rememberSplit(chainId, query.data, query.dataUpdatedAt);
  }, [chainId, query.data, query.dataUpdatedAt]);
  // Read after mount only: the server render has no storage.
  const [kept, setKept] = React.useState<Kept | null>(null);
  React.useEffect(() => setKept(chainId ? lastKnownSplit(chainId) : null), [chainId, query.isError]);
  return { query, split: splitTerms(query, kept) };
}
