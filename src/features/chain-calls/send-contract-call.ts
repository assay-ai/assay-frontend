import type { Signer } from "@/hooks/useSigner";
import type { Eip155UnsignedTransaction } from "@/interfaces/chain-transaction";
import type { SlashCallSignerRole, SlashContractCall } from "@/interfaces/slash-dispute";
import { sameEvmAddress, waitForContractCall } from "@/libs/chains/evm/contract-call";
import { contractErrorNameOf } from "@/libs/chains/evm/contract-error-selectors";
import { contractErrorText } from "@/libs/chains/evm/contract-errors";
import { fillTransaction } from "@/libs/chains/evm/deposit-transaction";
import { assertContractCall, type ExpectedCall } from "@/libs/chains/evm/signing-guard";

/**
 * Sending one of the dispute upgrade's unsigned calls from the one wallet the
 * contract accepts it from.
 *
 * The backend builds `{ to, data, value }` and names its `signer`; it holds no
 * key that could send it. This is the same path the stake intents take: the
 * page fills nonce, gas and fees from its own RPC (`fillTransaction`, which
 * also estimates AS the signer, so a call that would revert throws before any
 * prompt), and `useSigner`'s `signAndSend` signs and broadcasts — an embedded
 * wallet from the page, an injected one through its own RPC.
 *
 * It refuses, before the wallet is asked anything, a call from another
 * account than `signer`, a call carrying value, a call that does not decode to
 * exactly `expected` on the pinned contract (frontend review 2026-10-15, F1:
 * `functionName` and `requestIds` are the server's labels, `data` is what is
 * signed), and (inside `signAndSend`) a call for another chain than the one
 * the signer is bound to. A gas estimate
 * that reverts with a contract error this app knows (`contract-errors.ts`) is
 * refused in plain words, with the error's name.
 */

/** True when the wallet connected here is the account the call must come from. */
export function signerMatches(walletAddress: string | null | undefined, call: Pick<SlashContractCall, "signer">): boolean {
  return sameEvmAddress(walletAddress, call.signer);
}

/**
 * The spelling of `wanted` among the wallets connected here, so `useSigner`
 * (which matches an address exactly) finds a wallet whose address differs
 * only in checksum case. `wanted` itself when none matches.
 */
export function connectedSpelling(connected: readonly string[], wanted: string): string {
  return connected.find((address) => sameEvmAddress(address, wanted)) ?? wanted;
}

/** Who signs, in words, for the screen that shows the call. */
export function signerRoleLabel(role: SlashCallSignerRole | string | undefined): string {
  switch (role) {
    case "PROVIDER":
      return "The provider's stake wallet";
    case "ARBITER":
      return "The arbiter";
    case "ADMIN":
      return "The contracts' admin";
    default:
      return role ? `Unknown signer role (${role})` : "Not stated";
  }
}

export interface SendContractCallDeps {
  readonly fill: (input: {
    chainId: string;
    from: string;
    to: string;
    data: `0x${string}`;
  }) => Promise<Eip155UnsignedTransaction>;
  readonly wait: (chainId: string, hash: `0x${string}`, functionName: string) => Promise<void>;
}

const DEFAULT_DEPS: SendContractCallDeps = { fill: fillTransaction, wait: waitForContractCall };

/**
 * Fill, sign and send `call` from `signer`, then wait for it to be mined.
 * Resolves with the transaction hash once the receipt says success.
 */
export async function sendSlashContractCall(
  call: SlashContractCall,
  signer: Signer,
  expected: ExpectedCall,
  deps: SendContractCallDeps = DEFAULT_DEPS,
): Promise<`0x${string}`> {
  if (!signerMatches(signer.address, call)) {
    throw new Error(
      `This ${call.functionName} must be sent from ${call.signer}, and the connected wallet is ${signer.address}. Nothing was sent.`,
    );
  }
  if (call.value !== "0") {
    throw new Error(`Refusing to send ${call.value} wei with ${call.functionName}: it takes no value. Nothing was sent.`);
  }
  if (!/^0x[0-9a-fA-F]*$/.test(call.data)) {
    throw new Error(`The ${call.functionName} calldata is not hex. Nothing was sent.`);
  }
  assertContractCall(call, expected);
  let tx: Eip155UnsignedTransaction;
  try {
    tx = await deps.fill({
      chainId: call.chainId,
      from: signer.address,
      to: call.to,
      data: call.data as `0x${string}`,
    });
  } catch (error) {
    const name = contractErrorNameOf(error);
    const text = contractErrorText(name);
    if (name && text) {
      throw new Error(`The chain would refuse this ${call.functionName}: ${text} (${name}). Nothing was sent.`, {
        cause: error,
      });
    }
    throw error;
  }
  const hash = (await signer.signAndSend(tx)) as `0x${string}`;
  await deps.wait(call.chainId, hash, call.functionName);
  return hash;
}
