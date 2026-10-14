/**
 * The settlement contracts' refusals a person can meet when a chain call is
 * built or sent, in plain words.
 *
 * Every `Errors.sol` error is zero-argument, so a revert carries only its
 * 4-byte selector; the backend names it (assay-backend
 * `chains/evm/abi/error-selectors.ts`) and so does this file, for the reverts
 * the browser meets itself (a wallet's gas estimate). Only the errors with a
 * sentence here are named: the dispute, slash-wait and role ones an operator
 * or a provider can hit, as of assay-evm `9f036a3` (which removed
 * `ArbiterIsVerifier`, `VerifierIsAdminOrArbiter`, `RedeemerIsArbiter` and
 * `VerifierDailyCapExceeded`: the role checks are now `InvalidAdmin` /
 * `InvalidArbiter`, and a full daily cap is `SlashWindowNotDrained`).
 * Anything else stays the chain's or the backend's own words.
 *
 * Pure, with no chain SDK, so the status labels can use it; decoding a
 * selector is `contract-error-selectors.ts`.
 */
const CONTRACT_ERROR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  DisputeTimedOut:
    "This dispute went 30 days without a ruling. It can no longer be upheld, only expired, which releases the stake.",
  SlashAlreadyDisputed: "This penalty was already disputed once; a penalty can be disputed only one time.",
  InvalidArbiter:
    "The contract refuses this change: the arbiter cannot be the zero address, the admin, the redeemer or a live verifier key. One key holds one role.",
  InvalidAdmin:
    "The contract refuses this change: the admin cannot be the zero address or a live verifier key. One key holds one role.",
  SlashWindowNotDrained: "Waiting until today's penalty limit has room; it will be paid in full. The penalty stays pending until then.",
  ArbiterCannotUnblock: "The arbiter can only block. Lifting an on-chain block is the admin's.",
});

/** The contract error names this file has a sentence for. */
export const KNOWN_CONTRACT_ERRORS: readonly string[] = Object.freeze(Object.keys(CONTRACT_ERROR_TEXT));

const NAME_IN_TEXT = new RegExp(`\\b(${KNOWN_CONTRACT_ERRORS.join("|")})\\b`);

/** The plain sentence for a contract error name, or `null` when this file has none. */
export function contractErrorText(name: string | null | undefined): string | null {
  if (!name) return null;
  return Object.prototype.hasOwnProperty.call(CONTRACT_ERROR_TEXT, name) ? CONTRACT_ERROR_TEXT[name] : null;
}

/** A known contract error named in free text (a backend message, a node's revert string), or `null`. */
export function contractErrorNameInText(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  return NAME_IN_TEXT.exec(text)?.[1] ?? null;
}
