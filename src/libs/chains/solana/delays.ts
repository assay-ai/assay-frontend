/**
 * The settlement program's two waits, as constants — because that is what they
 * are now.
 *
 * In earlier program versions both of these were fields on the on-chain `Config`, movable by
 * the admin key inside program-enforced bounds, and no browser could know them
 * without an endpoint publishing them. That is why every screen in this app
 * renders a **server-supplied instant** and never `now + delay`: a duration the
 * browser added to its own clock would be wrong the first time an admin moved
 * the config, and wrong in the direction that tells someone their money is
 * ready before it is.
 *
 * The program removed the fields and hardcoded both values, for the reason its
 * own `state.rs` gives: *"a delay the admin key could shorten is a delay a
 * stolen admin key sets to zero."* They are now `SLASH_DELAY_SECONDS` and
 * `WITHDRAW_DELAY_SECONDS` in the program's `constants.rs` (assay-solana),
 * and changing either takes a program upgrade.
 *
 * **The instant rule is unchanged.** These constants are for *prose about the
 * next request* — "the wait is one hour", "inside a 72-hour timelock" — and
 * never for computing a deadline. A countdown still reads
 * `withdrawAvailableAt` / `earliestExecutionAt` off the server, because the
 * program compares against the cluster's clock and the browser's is not it.
 * `hooks/useCountdown.ts` takes an instant and refuses a duration for exactly
 * this reason.
 *
 * Transcribed from the program source rather than read off an endpoint: no
 * route publishes them any more, and there is nothing left for one to publish.
 * If the program upgrade ever changes them, this file is the single place that
 * moves.
 */

/**
 * `SLASH_DELAY_SECONDS` — 72 hours between a judgement being proposed and its
 * becoming executable.
 *
 * Frozen onto each `SlashRecord` at proposal as `executable_at`, so a change
 * cannot pull a pending judgement forward. Rendered here only as the length of
 * the band, never added to anything.
 */
export const SLASH_DELAY_SECONDS = 72 * 3_600;

/**
 * `WITHDRAW_DELAY_SECONDS` — one hour between a buyer's `request_withdraw` and
 * the `withdraw` that pays it.
 *
 * Sized, and asserted at compile time in the program, to exceed
 * `MAX_VOUCHER_REDEEMABLE_LIFE_SECONDS`: a voucher the buyer has already signed
 * must still be redeemable out of the escrow when the withdrawal is requested,
 * or a buyer could spend and then outrun the payment.
 */
export const WITHDRAW_DELAY_SECONDS = 3_600;

/** `SLASH_DELAY_SECONDS` in whole hours — 72. For prose, never for arithmetic on a clock. */
export const SLASH_DELAY_HOURS = SLASH_DELAY_SECONDS / 3_600;
