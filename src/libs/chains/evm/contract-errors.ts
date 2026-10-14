/**
 * The settlement contracts' refusals a person can meet when a chain call is
 * built or sent, in plain words.
 *
 * Every `Errors.sol` error is zero-argument, so a revert carries only its
 * 4-byte selector; the backend names it (assay-backend
 * `chains/evm/abi/error-selectors.ts`) and so does this file, for the reverts
 * the browser meets itself (a wallet's gas estimate). Only the errors with a
 * sentence here are named: the audit fix round's (assay-evm `a4f97ab`,
 * `6865b24`, `db9e396`) and the dispute ones an operator or a provider can
 * hit. Anything else stays the chain's or the backend's own words.
 *
 * Pure, with no chain SDK, so the status labels can use it; decoding a
 * selector is `contract-error-selectors.ts`.
 */
const CONTRACT_ERROR_TEXT: Readonly<Record<string, string>> = Object.freeze({
  DisputeTimedOut:
    "This dispute went 30 days without a ruling. It can no longer be upheld, only expired, which releases the stake.",
  SlashAlreadyDisputed: "This penalty was already disputed once; a penalty can be disputed only one time.",
  InvalidArbiter:
    "The contract refuses this arbiter: it cannot be the zero address, the admin, the redeemer or a registered verifier.",
  SlashWindowNotDrained:
    "Waiting for the daily cap to free up: a rolling slash window would cut this payment, so the chain holds it until the window drains. The penalty stays pending; try again later.",
  ArbiterCannotUnblock: "The arbiter can only block. Lifting an on-chain block is the admin's.",
  VerifierIsAdminOrArbiter:
    "The contract refuses this verifier key: it is the admin or the arbiter, and one key holds one role.",
  RedeemerIsArbiter:
    "The contract refuses these parameters: the redeemer would be the arbiter, and one key holds one role.",
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
