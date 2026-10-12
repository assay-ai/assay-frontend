/**
 * The asset the period screens (Overview, Spend, Guarantee, Statements) are
 * denominated in.
 *
 * `GET /receipts/summary` answers in ONE asset and refuses a window that spans
 * two unless `asset` names one. A buyer who holds one asset needs nothing; a
 * buyer who holds several sees the first until they pick another, and the pick
 * is remembered in this browser.
 */
import { getBalances } from "./balances.service";

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
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeDisplayAsset(asset: string): void {
  cached = null;
  try {
    window.localStorage.setItem(STORAGE_KEY, asset);
  } catch {
    // Private mode: the pick simply does not survive a reload.
  }
}

/** The assets this buyer holds, in the API's order, without duplicates. */
export async function heldAssets(): Promise<string[]> {
  const { balances } = await getBalances();
  return [...new Set(balances.map((row) => row.asset))];
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
