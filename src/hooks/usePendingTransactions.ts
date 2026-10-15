"use client";

import * as React from "react";

import {
  PENDING_TX_STORAGE_KEY,
  parsePending,
  withPending,
  withoutPending,
  type PendingTx,
} from "@/features/buyer-money/pending-tx";

/**
 * The pending-transaction list, shared by every component on the page and kept
 * in localStorage (see `features/buyer-money/pending-tx.ts`). Storage that
 * throws (private mode, blocked site data) degrades to "not remembered across
 * reloads", never to an error.
 */

const listeners = new Set<() => void>();
let cache: { raw: string | null; list: PendingTx[] } = { raw: null, list: [] };
const EMPTY: PendingTx[] = [];
/**
 * Ids a component on this page is still driving itself (the drawer that sent
 * it is waiting on it). The list leaves those alone so a deposit is never
 * credited twice from one page; after a reload this set is empty and the list
 * takes over.
 */
const driving = new Set<string>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PENDING_TX_STORAGE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): PendingTx[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, list: parsePending(raw) };
  return cache.list;
}

function write(list: PendingTx[]) {
  const raw = JSON.stringify(list);
  try {
    window.localStorage.setItem(PENDING_TX_STORAGE_KEY, raw);
    cache = { raw, list };
  } catch {
    // Not remembered across reloads; still shown for this page view.
    cache = { raw: cache.raw, list };
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PENDING_TX_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePendingTransactions() {
  const items = React.useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const track = React.useCallback((tx: PendingTx) => {
    driving.add(tx.id);
    write(withPending(snapshot(), tx));
  }, []);
  const resolve = React.useCallback((id: string) => {
    driving.delete(id);
    write(withoutPending(snapshot(), id));
  }, []);
  /** Stop driving an entry without forgetting it: the list picks it up (a failed or abandoned run). */
  const release = React.useCallback((id: string) => {
    if (!driving.delete(id)) return;
    snapshot();
    cache = { raw: cache.raw, list: [...cache.list] }; // a new identity, so subscribers re-render
    listeners.forEach((listener) => listener());
  }, []);
  /** Entries nobody on this page is driving: the ones to pick up again. */
  const orphaned = items.filter((tx) => !driving.has(tx.id));
  return { items, orphaned, track, resolve, release };
}
