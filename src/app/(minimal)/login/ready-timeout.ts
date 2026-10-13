/**
 * How long /login waits for Privy to report `ready` before it stops showing a
 * spinner and offers a reload (BUG-R8-L-01). Privy never becomes ready when it
 * refuses the origin or cannot be reached, and it reports that only to the
 * console.
 */
export const READY_TIMEOUT_MS = 10_000;

/**
 * Calls `onTimeout` once, `ms` from now, unless the returned cancel runs first.
 * The return value is an effect cleanup: cancel when `ready` arrives.
 */
export function startReadyTimeout(
  onTimeout: () => void,
  ms: number = READY_TIMEOUT_MS,
): () => void {
  const timer = setTimeout(onTimeout, ms);
  return () => clearTimeout(timer);
}
