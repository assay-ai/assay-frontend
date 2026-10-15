"use client";

import * as React from "react";

/**
 * What this browser did with a transaction built for someone else's key: the
 * file was downloaded for their Safe, or it was signed here and sent. Kept in
 * localStorage per record id (a penalty's request id, an approval id), so the
 * row and the sheet can say "File downloaded at 10:12, waiting for the
 * signature" after a reload, and a second download is warned about first
 * (operator review 2026-10-16b, P1-9).
 *
 * It is a note for this browser only: the chain is the record of what landed.
 * Entries older than a day are dropped; by then the row has moved or needs a
 * person. Storage that throws degrades to "not remembered", never an error.
 */
export interface HandoffRecord {
  readonly kind: "file" | "sent";
  /** Epoch ms. */
  readonly at: number;
  /** A sent transaction's hash and explorer link. */
  readonly hash?: string;
  readonly explorerUrl?: string;
}

export const HANDOFF_STORAGE_KEY = "assay.signing-handoffs.v1";
export const HANDOFF_MAX_AGE_MS = 24 * 3600 * 1000;

type Store = Record<string, HandoffRecord>;

function isRecord(value: unknown): value is HandoffRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (v.kind === "file" || v.kind === "sent") && typeof v.at === "number";
}

/** The stored map, without entries that are malformed or older than a day. */
export function parseHandoffs(raw: string | null, now: number = Date.now()): Store {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, HandoffRecord] => isRecord(entry[1]) && now - entry[1].at < HANDOFF_MAX_AGE_MS,
      ),
    );
  } catch {
    return {};
  }
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; store: Store } = { raw: null, store: {} };

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(HANDOFF_STORAGE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): Store {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, store: parseHandoffs(raw) };
  return cache.store;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === HANDOFF_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const EMPTY: Store = {};

/** Notes the same hand-off against every id it covers. */
export function recordHandoff(ids: readonly string[], record: HandoffRecord): void {
  if (ids.length === 0) return;
  const next: Store = { ...snapshot() };
  for (const id of ids) next[id.toLowerCase()] = record;
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(HANDOFF_STORAGE_KEY, raw);
    cache = { raw, store: next };
  } catch {
    // Not remembered across reloads; still shown for this page view.
    cache = { raw: cache.raw, store: next };
  }
  listeners.forEach((listener) => listener());
}

/** The latest hand-off noted for any of these ids, or null. */
export function latestHandoff(store: Store, ids: readonly string[]): HandoffRecord | null {
  let latest: HandoffRecord | null = null;
  for (const id of ids) {
    const record = store[id.toLowerCase()];
    if (record && (!latest || record.at > latest.at)) latest = record;
  }
  return latest;
}

export function useHandoff(ids: readonly string[] | undefined): HandoffRecord | null {
  const store = React.useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const key = (ids ?? []).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `ids`
  return React.useMemo(() => latestHandoff(store, ids ?? []), [store, key]);
}
