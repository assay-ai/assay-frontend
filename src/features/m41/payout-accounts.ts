import type { ProviderPayoutAccount } from "@/interfaces";
import { chainIdOfAccount } from "@/utils/chain";

/**
 * Reading `registration.payoutAccounts` — the payout step, per chain.
 *
 * ## A proved address is not a tick
 *
 * The backend had exactly this bug and fixed it: this step read
 * "Payout wallet ✓" on **any** enrolment status, so a provider whose only
 * enrolment was `SUSPENDED` was reassured by their own console while every
 * paid binding they owned was refused. Only `ACTIVE` is payable. The address
 * answers "where", the status answers "whether", and the second is the half
 * that decides whether money arrives.
 *
 * ## What a fresh proof is, and is not, evidence of
 *
 * `POST /providers/me/payout-address` answers with a CAIP-10 address and **no
 * status**, and the read that would carry one is cached: the API answers every
 * provider GET `private, max-age=10, stale-while-revalidate=3600`, so a refetch
 * straight after a write is served the pre-write body out of the browser's own
 * HTTP cache — for up to an hour, and invalidating the React Query key does not
 * reach it. So the just-proved address has to be layered over the read, or the
 * screen walks backwards and tells a provider their address is unproved after
 * the platform accepted it.
 *
 * It is layered on **one** rule, which comes from the backend's upsert and not
 * from optimism: proving on a chain with no enrolment row INSERTS one, and it
 * inserts it `ACTIVE`; proving on a chain that already has a row UPDATES only
 * the address and its proof, leaving `status` and `enrolled_at` alone — on
 * purpose, so that a `SUSPENDED` enrolment cannot be made routable again by its
 * owner signing a message. A read can be stale, but staleness cannot invent a
 * suspension: if the list says `SUSPENDED`, it was suspended when it was read,
 * and signing did not change that. So a proof on a chain the list does not
 * mention is known-`ACTIVE`, and a proof on a chain the list does mention is
 * worth exactly what the list says.
 */

/** An address proved in this session that the (cached) read does not carry yet. */
export function justProvedAccountId(
  payoutAccounts: readonly ProviderPayoutAccount[],
  provedNow: string | null,
): string | null {
  if (!provedNow) return null;
  return payoutAccounts.some((account) => account.accountId === provedNow) ? null : provedNow;
}

/**
 * Whether a just-proved address enrolled a chain the read does not mention —
 * the one case in which a proof is, by itself, evidence of an `ACTIVE`
 * enrolment. See the module docstring: that is the branch where the backend
 * INSERTS, and it inserts `ACTIVE`.
 */
export function provedChainIsNew(
  payoutAccounts: readonly ProviderPayoutAccount[],
  provedNow: string | null,
): boolean {
  const pending = justProvedAccountId(payoutAccounts, provedNow);
  if (!pending) return false;

  const chainId = chainIdOfAccount(pending);
  if (!chainId) return false;
  return !payoutAccounts.some((account) => account.chainId === chainId);
}

/**
 * Whether step 2 is genuinely done — at least one chain that is proved **and**
 * payable. See the module docstring for why a fresh proof counts only when its
 * chain is absent from the read.
 */
export function payoutStepIsDone(
  payoutAccounts: readonly ProviderPayoutAccount[],
  provedNow: string | null,
): boolean {
  if (payoutAccounts.some((account) => account.status === "ACTIVE")) return true;
  return provedChainIsNew(payoutAccounts, provedNow);
}
