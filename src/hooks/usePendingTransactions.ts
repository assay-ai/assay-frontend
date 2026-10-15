"use client";

import * as React from "react";

import { PENDING_TX_STORAGE_KEY, parsePending, type PendingTx } from "@/features/buyer-money/pending-tx";

/**
 * The pending-transaction list, shared by every component on the page and kept
 * in localStorage (see `features/buyer-money/pending-tx.ts`). Storage that
 * throws (private mode, blocked site data) degrades to "not remembered across
 * reloads", never to an error.
 */

/** What a store keeps: anything with a stable id. */
interface Keyed {
  id: string;
}

/**
 * One localStorage-backed pending list, with its own key and parser. The buyer
 * list below is one; the provider's stake and dispute list
 * (`features/provider-stake/pending-chain-tx.ts`) is another, under its own key
 * so neither console shows the other's transactions.
 */
export function createPendingStore<T extends Keyed>(storageKey: string, parse: (raw: string | null) => T[]) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; list: T[] } = { raw: null, list: [] };
  const EMPTY: T[] = [];
  /**
   * Ids a component on this page is still driving itself (the drawer that sent
   * it is waiting on it). The list leaves those alone so a deposit is never
   * credited twice from one page; after a reload this set is empty and the list
   * takes over.
   */
  const driving = new Set<string>();

  function readRaw(): string | null {
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }

  function snapshot(): T[] {
    const raw = readRaw();
    if (raw !== cache.raw) cache = { raw, list: parse(raw) };
    return cache.list;
  }

  function write(list: T[]) {
    const raw = JSON.stringify(list);
    try {
      window.localStorage.setItem(storageKey, raw);
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
      if (event.key === storageKey) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return function usePendingStore() {
    const items = React.useSyncExternalStore(subscribe, snapshot, () => EMPTY);
    const track = React.useCallback((tx: T) => {
      driving.add(tx.id);
      write([...snapshot().filter((item) => item.id !== tx.id), tx]);
    }, []);
    const resolve = React.useCallback((id: string) => {
      driving.delete(id);
      write(snapshot().filter((item) => item.id !== id));
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
  };
}

const useBuyerPending = createPendingStore<PendingTx>(PENDING_TX_STORAGE_KEY, parsePending);

export function usePendingTransactions() {
  return useBuyerPending();
}
