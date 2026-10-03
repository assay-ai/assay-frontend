import { redirect } from "next/navigation";

/**
 * `/funding/withdraw` → `/funding/escrow`.
 *
 * What used to live here was the withdraw screen, a screen with a real balance and a fake
 * withdrawal. Its signing flow had already been deleted for signing nothing —
 * a message composed in the browser, no nonce, no expiry, no stored row to
 * verify it against, aimed at a destination spelled `7xKX…9pQr`, with the
 * signature thrown away and a success state rendered for a withdrawal that had
 * not happened. What was left after that deletion was a balance and a sentence
 * saying withdrawals were not open yet.
 *
 * They are open now. `/funding/escrow` reads the buyer's own on-chain escrow
 * and runs the real two-step, wallet-signed withdrawal against it, so this path
 * has nothing left to render — including the balance and holds figures, which
 * came from the platform's ledger and are superseded there by the token
 * account's own reading.
 *
 * A redirect rather than a deletion: `/funding` linked here, the buyer shell's
 * `TITLES` map names it, and it is a path people have bookmarked. Sending them
 * to the screen that does the thing is better than a 404.
 *
 * A server component and `redirect()`, not a `next.config` rule: this repo's
 * `next.config.js` declares no `redirects()` and adding the project's first one
 * to move a single route would put the fact somewhere no one reading `app/`
 * would find it.
 */
export default function WithdrawPage() {
  redirect("/funding/escrow");
}
