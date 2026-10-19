import type { DelegateIntent, RelayedDelegate } from "@/interfaces";
import { isTypedDataRequest } from "@/interfaces/chain-transaction";
import type { Signer } from "@/hooks/useSigner";
import { relayedSubmitBody } from "@/features/escrow/relayed-submission";
import { assertTypedData } from "@/libs/chains/evm/signing-guard";

export const DELEGATION_SUBMISSION_REFUSED = "DELEGATION_SUBMISSION_REFUSED";

const PRIMARY_TYPE: Record<DelegateIntent["kind"], string> = {
  AUTHORIZE_DELEGATE: "AuthorizeDelegate",
  REVOKE_DELEGATE: "RevokeDelegate",
};

/**
 * The escrow's EIP-712 domain as THIS app knows it: the chain from the payer's
 * account, the contract from `GET /escrow`. Never taken from the request, and
 * the request must also match the contracts pinned in the bundle.
 */
export interface ExpectedDomain {
  /** EVM chain id, decimal. */
  chainId: string;
  /** The escrow proxy's 0x address. */
  verifyingContract: string;
}

/** What the person chose on the screen; the request must say exactly this before it is signed. */
export interface ExpectedDelegation {
  domain: ExpectedDomain;
  delegate: string;
  maxVoucherAmount?: string;
  maxPerWindow?: string;
  validUntil?: string;
}

function sameAddress(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function addressOf(account: string): string {
  const parts = account.split(":");
  return parts.length >= 3 ? parts[parts.length - 1] : account;
}

/**
 * Signs a relayed `AuthorizeDelegate` / `RevokeDelegate` with the payer's wallet
 * and hands it to the relay — the delegation twin of `submitRelayedEscrowIntent`.
 *
 * Refuses, BEFORE the wallet is asked for anything:
 * - a payload that is not a relayed EIP-712 request, or whose primary type is
 *   not the one this kind of request signs;
 * - a request made out to a payer other than the connected wallet (the
 *   contract recovers the signer and compares — the prompt would be wasted);
 * - a request whose delegate, caps or expiry differ from what the person chose;
 * - a request under any other EIP-712 domain (name, version, chain, escrow) or
 *   with anything but the canonical field list (review S3-10): a grant signed
 *   for another deployment is a grant somewhere else.
 *   The signature IS the grant, so the screen checks it is granting what it
 *   showed, and never trusts the server to have built that.
 */
export async function submitRelayedDelegation(
  intent: DelegateIntent,
  signer: Signer,
  expected: ExpectedDelegation,
  submit: (body: Record<string, unknown>) => Promise<RelayedDelegate>,
): Promise<RelayedDelegate> {
  const tx = intent.transaction;
  if (!isTypedDataRequest(tx)) {
    throw new Error(
      `${DELEGATION_SUBMISSION_REFUSED}: the delegation request is not a relayed signature request.`,
    );
  }
  if (tx.primaryType !== PRIMARY_TYPE[intent.kind]) {
    throw new Error(
      `${DELEGATION_SUBMISSION_REFUSED}: a ${intent.kind} request must sign ${PRIMARY_TYPE[intent.kind]}, not ${tx.primaryType}.`,
    );
  }
  // The pinned escrow domain and the canonical struct, the check every
  // signing path shares (`libs/chains/evm/signing-guard.ts`).
  assertTypedData(
    tx,
    { chainId: `eip155:${expected.domain.chainId}`, primaryTypes: [PRIMARY_TYPE[intent.kind]], message: {} },
    DELEGATION_SUBMISSION_REFUSED,
  );
  // The escrow `GET /escrow` served must be that same pinned contract.
  if (!sameAddress(tx.domain.verifyingContract, expected.domain.verifyingContract)) {
    throw new Error(
      `${DELEGATION_SUBMISSION_REFUSED}: the request to sign is not for this escrow (verifyingContract). Nothing was signed.`,
    );
  }

  const message = tx.message;
  if (!sameAddress(message.payer, signer.address)) {
    throw new Error(
      `${DELEGATION_SUBMISSION_REFUSED}: this request is made out to ${String(message.payer)} and the connected wallet is ${signer.address}.`,
    );
  }
  const mismatched: string[] = [];
  if (!sameAddress(message.delegate, addressOf(expected.delegate)))
    mismatched.push("delegate");
  for (const field of [
    "maxVoucherAmount",
    "maxPerWindow",
    "validUntil",
  ] as const) {
    const want = expected[field];
    if (want !== undefined && String(message[field]) !== want)
      mismatched.push(field);
  }
  if (mismatched.length > 0) {
    throw new Error(
      `${DELEGATION_SUBMISSION_REFUSED}: the request to sign does not match what you chose (${mismatched.join(", ")}). Nothing was signed.`,
    );
  }

  // AuthorizeDelegate: Privy's confirmation is always shown (spec R-WEB-5).
  const signature = await signer.signTypedData(tx, { showWalletUIs: true });
  return submit(relayedSubmitBody(tx, signature));
}
