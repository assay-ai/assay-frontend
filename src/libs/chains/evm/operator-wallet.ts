import { getAddress, stringToHex } from "viem";
import { parseSiweMessage } from "viem/siwe";

import type { Eip1193Like } from "./injected-send";
import { ROBINHOOD_MAINNET_STAKE, ROBINHOOD_TESTNET_DEV_STAKE } from "./stake-slashes/deployments";

/**
 * The two EVM pieces of the operator console's wallet sign-in and directory.
 *
 * Here because `src/libs/chains/` is the only place a chain SDK may be
 * imported (`eslint.config.mjs`, `assay/chain-sdk-boundary`).
 */

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

export type AddressCheck =
  | { readonly ok: true; readonly checksummed: `0x${string}` }
  | { readonly ok: false; readonly error: string };

/**
 * An EVM address, checked against EIP-55.
 *
 * All lower-case (or all upper-case) hex carries no checksum and is accepted
 * as written; mixed case IS a checksum, and one that does not match is
 * refused — it is the sign of a mistyped character.
 */
export function checkEvmAddress(input: string): AddressCheck {
  const value = input.trim();
  if (!ADDRESS_SHAPE.test(value)) {
    return { ok: false, error: "An EVM address is 0x followed by 40 hex characters." };
  }
  const checksummed = getAddress(value.toLowerCase());
  const body = value.slice(2);
  const unchecked = body === body.toLowerCase() || body === body.toUpperCase();
  if (!unchecked && value !== checksummed) {
    return {
      ok: false,
      error: "The capital letters do not match the address checksum (EIP-55). Check for a mistyped character.",
    };
  }
  return { ok: true, checksummed };
}

/** `0xabc…` → `0xAbC…`. Returns the input unchanged when it is not an address. */
export function toChecksumAddress(address: string): string {
  return ADDRESS_SHAPE.test(address) ? getAddress(address.toLowerCase()) : address;
}

/**
 * `personal_sign` the message EXACTLY as given, through any EIP-1193 provider
 * (an injected wallet such as MetaMask, a hardware wallet behind one, or the
 * Privy embedded wallet's provider).
 *
 * The message goes over as the hex of its UTF-8 bytes, the form every wallet
 * accepts; the wallet shows the decoded text and signs the EIP-191 prefix over
 * the same bytes the backend verifies. Nothing is trimmed or re-wrapped.
 */
export async function personalSign(
  provider: Eip1193Like,
  address: string,
  message: string,
): Promise<`0x${string}`> {
  const signature = await provider.request({
    method: "personal_sign",
    params: [stringToHex(message), address],
  });
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error(`The wallet answered personal_sign with something that is not a signature (${JSON.stringify(signature)}).`);
  }
  return signature as `0x${string}`;
}

/** The statement every operator sign-in message carries, word for word (backend `OPERATOR_SIGN_IN_STATEMENT`). */
export const OPERATOR_SIGN_IN_STATEMENT = "Sign in to the Assay operator console";

/**
 * The chain ids an operator sign-in message may name: the chains this bundle
 * pins (Robinhood Chain mainnet and testnet). The backend names one
 * (`OPERATOR_SIGN_IN_CHAIN_ID`, 46630 by default); no transaction is made on it.
 */
export const OPERATOR_SIGN_IN_CHAIN_IDS: readonly number[] = [ROBINHOOD_MAINNET_STAKE, ROBINHOOD_TESTNET_DEV_STAKE].map(
  (deployment) => Number(deployment.chainId.slice(deployment.chainId.indexOf(":") + 1)),
);

/** A challenge is good for 5 minutes (backend `OPERATOR_CHALLENGE_TTL_SECONDS`); more than this is refused. */
const MAX_CHALLENGE_LIFETIME_MS = 15 * 60_000;
/** How far the browser's clock may be behind the backend's (`Issued At` in the future). */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Why an operator sign-in message must not be signed, or `null` when it may be.
 *
 * The message comes from the API. Signed as is, a message naming another
 * site would sign the operator in THERE (EIP-4361), and an embedded wallet
 * does not check the domain itself. So, before the wallet is asked: the
 * domain is this page's host, the URI is on this page's origin, the address
 * is the signing wallet, the chain is one this bundle pins, the statement is
 * the console's, and the times are a fresh, short-lived challenge.
 */
export function operatorSignInMessageProblem(
  message: string,
  expected: { readonly address: string; readonly host: string; readonly origin: string; readonly nowMs: number },
): string | null {
  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(message);
  } catch {
    return "it is not a Sign-In with Ethereum message";
  }
  if (fields.version !== "1") return "it is not a Sign-In with Ethereum message";
  if (fields.domain !== expected.host) return `it signs in to ${fields.domain ?? "no site"}, not ${expected.host}`;
  let uriOrigin: string | null = null;
  try {
    uriOrigin = fields.uri ? new URL(fields.uri).origin : null;
  } catch {
    uriOrigin = null;
  }
  if (uriOrigin !== expected.origin) return `its URI ${fields.uri ?? "(none)"} is not on ${expected.origin}`;
  if (!fields.address || fields.address.toLowerCase() !== expected.address.toLowerCase()) {
    return "it names another wallet";
  }
  if (fields.chainId === undefined || !OPERATOR_SIGN_IN_CHAIN_IDS.includes(fields.chainId)) {
    return `it names chain ${fields.chainId ?? "(none)"}, not one this app uses`;
  }
  if (fields.statement !== OPERATOR_SIGN_IN_STATEMENT) return "it is not the operator console's sign-in";
  const issued = fields.issuedAt?.getTime();
  const expires = fields.expirationTime?.getTime();
  if (issued === undefined || expires === undefined || Number.isNaN(issued) || Number.isNaN(expires)) {
    return "it has no issue or expiry time";
  }
  if (expires <= expected.nowMs) return "it has expired";
  if (issued > expected.nowMs + CLOCK_SKEW_MS) return "it is issued in the future";
  if (expires <= issued || expires - issued > MAX_CHALLENGE_LIFETIME_MS) return "it stays valid for too long";
  if (fields.notBefore && fields.notBefore.getTime() > expected.nowMs + CLOCK_SKEW_MS) return "it is not valid yet";
  return null;
}
