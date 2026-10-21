/**
 * The asset the period screens (Overview, Spend, Guarantee, Statements) are
 * denominated in.
 *
 * `GET /receipts/summary` answers in ONE asset and refuses a window that spans
 * two unless `asset` names one. A buyer who holds one asset needs nothing; a
 * buyer who holds several sees the first until they pick another, and the pick
 * is remembered in this browser.
 */
import { BALANCES_KEY, getBalances } from "./balances.service";
import { sharedRead } from "./shared-reads";

/** As fresh as the screens' own balances read (`LIVE_STALE_MS`). */
const LIVE_READ_MS = 2_000;

const STORAGE_KEY = "displayAsset";

export function pickDisplayAsset(
  held: readonly string[],
  stored: string | null
): string | undefined {
  const distinct = [...new Set(held)];
  if (distinct.length < 2) return undefined;
  return stored !== null && distinct.includes(stored) ? stored : distinct[0];
}

export function storedDisplayAsset(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memoryPick;
  } catch {
    return memoryPick;
  }
}

let memoryPick: string | null = null;
const listeners = new Set<() => void>();

/** Called whenever the pick changes, so a screen can refetch without a page reload. */
export function subscribeDisplayAsset(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function storeDisplayAsset(asset: string): void {
  cached = null;
  memoryPick = asset;
  try {
    window.localStorage.setItem(STORAGE_KEY, asset);
  } catch {
    // Private mode: the pick simply does not survive a reload.
  }
  for (const listener of listeners) listener();
}

/** The assets in these balance rows, in the API's order, without duplicates. */
export function assetsOfBalances(balances: readonly { asset: string }[]): string[] {
  return [...new Set(balances.map((row) => row.asset))];
}

/**
 * The assets this buyer holds, in the API's order, without duplicates. Read
 * through the screens' `["balances"]` query (`sharedRead`), so it is not a
 * `GET /balances` of its own.
 */
export async function heldAssets(): Promise<string[]> {
  const { balances } = await sharedRead(BALANCES_KEY, getBalances, LIVE_READ_MS);
  return assetsOfBalances(balances);
}

let cached: { at: number; value: Promise<string | undefined> } | null = null;

/**
 * The asset to send as `?asset=`, or `undefined` for a one-asset buyer.
 *
 * Memoised for a few seconds: one screen fires several summary requests at
 * once and they must all name the same asset off one `GET /balances`.
 */
export function resolveDisplayAsset(): Promise<string | undefined> {
  const now = Date.now();
  if (!cached || now - cached.at > 10_000) {
    const value = heldAssets()
      .then((held) => pickDisplayAsset(held, storedDisplayAsset()))
      // No balances, no opinion: let the API answer as it did before.
      .catch(() => undefined);
    cached = { at: now, value };
  }
  return cached.value;
}
