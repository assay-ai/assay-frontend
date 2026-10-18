/**
 * Whether a payment's `chainTxRef` names a real transaction an explorer can
 * open. The backend sends `null` for a redemption whose signature was not
 * observed; a ref with a `scheme:` prefix (`unobserved:seq=…`,
 * `held_collected:seq=…`, `legacy:…`) is a ledger marker, never a
 * transaction, so it gets no "View transaction" link (B13 review I1).
 */
export function isTransactionRef(ref: string | null | undefined): ref is string {
  return Boolean(ref) && !/^[a-z_]+:/i.test(ref as string);
}
