/**
 * @fileoverview
 * The relayed half of an escrow action — sign an EIP-712 request, hand the
 * signature back to the platform, let the platform pay the gas.
 *
 * ## Why this exists at all
 *
 * `setEscrowLimits` and `requestWithdraw` on `X402Escrow` are `msg.sender`-only.
 * A buyer holding USDG and **no ETH** therefore cannot arm their own escrow and
 * cannot start their own exit — the two things they most need to be able to do
 * without asking anyone. The answer is `setLimitsBySig` / `requestWithdrawBySig`:
 * The buyer signs a struct, the platform's relayer submits the call and pays
 * for it, and `ecrecover` inside the contract is what binds the action to the
 * buyer. The platform can relay it or refuse to; it cannot change what it says.
 *
 * So this module is the browser's half of that: sign, post, report. It is the
 * ONLY place in this app that sends a signature to the platform, and everything
 * about it is shaped by that being an unusual thing for this codebase to do.
 *
 * ## What it is not
 *
 * Not a submit path for transactions. `signTransaction` on the EVM branch of
 * `useSigner` throws, deliberately, and `withdraw()` has no relayed form in the
 * contract or its bytecode — {@link submitRelayedEscrowIntent} refuses a
 * `WITHDRAW` by name rather than inventing a route for it. A relayed *signature*
 * is bounded by what the buyer signed; a relayed *transaction* would not be.
 *
 * ## The body is the issued message, echoed
 *
 * `{ ...message, signature }` — the intent route's own `message` object with a
 * signature added, and nothing re-derived. A client that rebuilt any field could
 * sign one struct and post another, and the contract's refusal would arrive as
 * `SignerIsNotBuyer`: a marshalling bug reported as a signature failure, which
 * is close to undiagnosable from either end. The backend's DTO runs
 * `forbidNonWhitelisted`, so a field the struct grows without the DTO growing it
 * is a 400 naming the field — loud, at the seam that owns the vocabulary.
 */

import type {
  RelayedEscrowIntent,
  SubmitRequestWithdrawBody,
  SubmitSetLimitsBody,
} from "@/interfaces";
import type {
  Eip155TypedDataRequest,
  UnsignedChainTransaction,
} from "@/interfaces/chain-transaction";
import { isTypedDataRequest } from "@/interfaces/chain-transaction";
import type { Signer } from "@/hooks/useSigner";
import { submitEscrowLimits, submitEscrowWithdrawRequest } from "@/services/escrow.service";
import type { SignableIntent } from "./run-escrow-intent";
import { runEscrowIntent } from "./run-escrow-intent";

/**
 * The two shapes an escrow action can end in, and they are genuinely different
 * outcomes rather than two spellings of "done".
 *
 * `broadcast` — the buyer's own wallet put a transaction on chain and the
 * reference is theirs. `relayed` — the buyer signed, the platform submitted,
 * and the answer is a *mined* transaction with a block and a gas figure the
 * buyer did not pay. A screen that collapsed the two would either promise a
 * Solana buyer that the platform paid their fee, or tell a zero-ETH EVM buyer
 * to wait for a confirmation that has already happened.
 */
export type EscrowActionResult =
  | { readonly kind: "broadcast"; readonly signature: string }
  | { readonly kind: "relayed"; readonly relayed: RelayedEscrowIntent };

/** The intent kinds that have a relayed door. There is no `withdrawBySig`. */
export type RelayedIntentKind = "SET_LIMITS" | "REQUEST_WITHDRAW";

/**
 * The submit routes, injected rather than imported.
 *
 * Injected so the dispatch below — *which* route a kind goes to — is testable
 * without a network, and so a test asserting "a `SET_LIMITS` never reaches the
 * withdrawal route" is asserting the shipped table rather than a copy of it.
 * The page passes {@link ESCROW_SUBMITTERS}.
 */
export interface RelayedSubmitters {
  readonly SET_LIMITS: (body: Record<string, unknown>) => Promise<RelayedEscrowIntent>;
  readonly REQUEST_WITHDRAW: (body: Record<string, unknown>) => Promise<RelayedEscrowIntent>;
}

/** Refusals this module raises before anything reaches a wallet or the network. */
export const RELAYED_SUBMISSION_REFUSED = "RELAYED_SUBMISSION_REFUSED";

/**
 * Whether two addresses name the same account on this chain.
 *
 * Case-insensitive, and only because of what the case *is* on `eip155`: EIP-55
 * carries a checksum in the case of the hex digits, so `0x7fd9…f8d1` and
 * `0x7FD9…F8D1` are one address and a wallet is entitled to echo back either.
 * The backend's own `assertIsOwnAccount` lowercases for exactly this reason.
 *
 * Deliberately NOT used for `solana`, where case is significant and two strings
 * differing by case are two different accounts. Nothing calls it there: this
 * module runs only on the typed-data member, which is `eip155` by construction.
 */
function sameEvmAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * The body for a submit route: the signed message, verbatim, plus `signature`.
 *
 * The structural check is the one thing added on top of the spread. Every field
 * the struct declares in `types[primaryType]` must actually be present in
 * `message` — because a field that is absent is `undefined`, `JSON.stringify`
 * drops it, and what arrives at the backend is a body missing a field the
 * signature *covers*. The contract then hashes a different struct and answers
 * `SignerIsNotBuyer`. Refusing here names the field instead.
 */
export function relayedSubmitBody(
  request: Eip155TypedDataRequest,
  signature: string,
): Record<string, unknown> {
  const fields = request.types[request.primaryType];
  if (!fields || fields.length === 0) {
    throw new Error(
      `${RELAYED_SUBMISSION_REFUSED}: the signature request declares no fields for its own ` +
        `primary type ${JSON.stringify(request.primaryType)}, so there is nothing to echo back.`,
    );
  }
  const missing = fields
    .map((field) => field.name)
    .filter((name) => request.message[name] === undefined || request.message[name] === null);
  if (missing.length > 0) {
    throw new Error(
      `${RELAYED_SUBMISSION_REFUSED}: the signed ${request.primaryType} message is missing ` +
        `${missing.join(", ")}. The signature covers those fields; posting without them would ` +
        `be refused by the contract as a bad signature rather than as a missing field.`,
    );
  }
  return { ...request.message, signature };
}

/**
 * Sign one relayed request with the buyer's own wallet and post it.
 *
 * **The signer must already be the buyer.** `useSigner({ address })` selects the
 * connected wallet by address and hands back no signer when none matches — that
 * is the contract this function relies on, and the assertion below is what makes
 * the reliance checkable rather than assumed. Privy defaults to the *first*
 * wallet when no address is passed, which is the embedded one; a screen that
 * forgot the address would produce a genuine signature from the wrong account,
 * and the buyer would watch their own wallet approve something the platform
 * then refuses 403. Every path here is guarded against that ending in silence.
 */
export async function submitRelayedEscrowIntent(
  intent: { kind: string; transaction: UnsignedChainTransaction },
  signer: Signer,
  submitters: RelayedSubmitters,
): Promise<RelayedEscrowIntent> {
  const transaction = intent.transaction;
  if (!isTypedDataRequest(transaction)) {
    throw new Error(
      `${RELAYED_SUBMISSION_REFUSED}: this payload is not a relayed signature request, so there ` +
        `is nothing for the platform to submit. Broadcast it from the wallet instead.`,
    );
  }

  const submit = relayedSubmitterFor(intent.kind, submitters);
  if (submit === null) {
    /*
      `WITHDRAW` lands here, and that is the case worth naming. `withdraw()` is
      `msg.sender`-only, there is no `withdrawBySig` in the contract or in its
      bytecode, and the platform has no submit endpoint for one. Picking the
      "closest" route would relay a withdrawal request in place of a withdrawal
      — the buyer would see a success for an action that did not happen and
      their money would still be in the escrow.
    */
    throw new Error(
      `${RELAYED_SUBMISSION_REFUSED}: ${intent.kind} has no relayed door. Only SET_LIMITS and ` +
        `REQUEST_WITHDRAW can be submitted for a buyer; withdraw() is msg.sender-only.`,
    );
  }

  const buyer = transaction.message.buyer;
  if (typeof buyer !== "string" || buyer === "") {
    throw new Error(
      `${RELAYED_SUBMISSION_REFUSED}: the signature request carries no buyer, so there is no ` +
        `address to check this wallet against.`,
    );
  }
  if (!sameEvmAddress(signer.address, buyer)) {
    /*
      THE trap, and it is checked here rather than trusted from the screen.
      The contract recovers the signer from the signature and compares it with
      `buyer`; a signature from any other wallet is a valid signature over the
      right struct by the wrong person, and it fails 100% of the time — after
      the user approved a prompt. The platform refuses it first, 403
      `SETTLEMENT_RELAYED_INTENT_FOR_ANOTHER_BUYER`, because it is the platform
      paying the gas. Either way the prompt was wasted, so it is refused before
      the wallet is asked for anything.
    */
    throw new Error(
      `${RELAYED_SUBMISSION_REFUSED}: this request is made out to ${buyer} and the connected ` +
        `wallet is ${signer.address}. Only ${buyer} can sign it — the contract recovers the ` +
        `signer and compares the two.`,
    );
  }

  const signature = await signer.signTypedData(transaction);
  return submit(relayedSubmitBody(transaction, signature));
}

/**
 * One escrow action, relayed or self-submitted, whichever it turns out to be.
 *
 * The dispatch is on the payload's own `kind`, never on the screen's chain:
 * The backend answers `typed-data` exactly when it built a relayed request, and
 * a screen deciding for itself ("EVM means relayed") would be wrong about
 * `withdraw()`, which is an ordinary transaction on the same chain.
 *
 * Kept as one function so both escrow screens run the same dispatch. Two copies
 * of a two-branch `if` in two page components is two places for the relayed
 * branch to be forgotten, and a page component is the one place in this app
 * nothing can test.
 */
export async function runEscrowAction(
  intent: SignableIntent & { kind: string },
  signer: Signer,
  submitters: RelayedSubmitters = ESCROW_SUBMITTERS,
): Promise<EscrowActionResult> {
  if (isTypedDataRequest(intent.transaction)) {
    return {
      kind: "relayed",
      relayed: await submitRelayedEscrowIntent(intent, signer, submitters),
    };
  }
  return { kind: "broadcast", signature: (await runEscrowIntent(intent, signer)).signature };
}

/**
 * `kind` → its submit route, as a lookup that cannot answer for a kind it does
 * not have.
 *
 * A `switch` and not an index read. `submitters[kind as RelayedIntentKind]` is
 * typed non-optional under this tsconfig — `noUncheckedIndexedAccess` is off —
 * so the `undefined` a `WITHDRAW` produces would be invisible to `tsc` and the
 * refusal below would be dead code that looks live. The one kind with no
 * relayed door is the one this has to get right.
 */
function relayedSubmitterFor(
  kind: string,
  submitters: RelayedSubmitters,
): RelayedSubmitters[RelayedIntentKind] | null {
  if (kind === "SET_LIMITS") return submitters.SET_LIMITS;
  if (kind === "REQUEST_WITHDRAW") return submitters.REQUEST_WITHDRAW;
  return null;
}

/**
 * The real routes, wired to the real services.
 *
 * The two casts are the one place this module admits it is echoing the server's
 * own message rather than a shape it built. They are honest for a checked
 * reason: {@link relayedSubmitBody} has just asserted that every field the
 * struct declares in `types[primaryType]` is present, so the object carries the
 * fields the signature covers. What a structural type could not add on top of
 * that is anything the *backend* does not also check — its DTO validates every
 * field again and `forbidNonWhitelisted` refuses any extra one by name.
 */
export const ESCROW_SUBMITTERS: RelayedSubmitters = {
  SET_LIMITS: (body) => submitEscrowLimits(body as unknown as SubmitSetLimitsBody),
  REQUEST_WITHDRAW: (body) =>
    submitEscrowWithdrawRequest(body as unknown as SubmitRequestWithdrawBody),
};
