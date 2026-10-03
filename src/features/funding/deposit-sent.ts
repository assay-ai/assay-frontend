import { shortAddress } from "@/libs/chains/format";

/**
 * What the buyer is told after a deposit is sent, now that the screen goes
 * straight back to `/funding` instead of holding a result box.
 *
 * The box said three things, and the notice keeps all three: that the money
 * was sent, the transaction it went in (shortened — the full hash is on the
 * Deposits table the buyer lands on), and that a first deposit opens an escrow
 * that refuses paid calls until the buyer sets limits (`limitsHref`, rendered
 * as the toast's action).
 */
export interface DepositSentNotice {
  readonly message: string;
  readonly description: string;
  readonly limitsHref: string;
}

export function depositSentNotice(input: {
  /** Already formatted, e.g. "$5.00". */
  readonly amount: string;
  readonly chainId: string;
  /** The settled transaction, or `null` when the settle named none. */
  readonly reference: string | null;
}): DepositSentNotice {
  const reference = input.reference ? ` in ${shortAddress(input.chainId, input.reference)}` : "";
  return {
    message: `Deposit of ${input.amount} sent`,
    description:
      `Sent${reference} — confirming on chain; your balance updates once it is final. ` +
      `A first deposit opens your escrow, which refuses paid calls until you set its limits.`,
    limitsHref: "/funding/escrow/limits",
  };
}
