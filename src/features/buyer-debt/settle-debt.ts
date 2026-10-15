
import type { Signer } from "@/hooks/useSigner";
import type {
  BuyerDebt,
  DebtVoucherIntent,
  SettleDebtBody,
  SettleDebtResult,
} from "@/interfaces/buyer-debt";
import type { Eip155TypedDataRequest } from "@/interfaces/chain-transaction";
import { assertTypedData } from "@/libs/chains/evm/signing-guard";
import { voucherResourceHash } from "@/libs/chains/evm/voucher-hash";

/**
 * Settling one buyer debt from the console: get the replacement voucher, have
 * the payer's own wallet sign its EIP-712 form, send the signature back.
 *
 * The backend chooses every field, so nothing is signed on its word. Before
 * the wallet is asked, the request must be the `Voucher` struct under the
 * escrow contract pinned in this bundle for the payer's chain (the shared
 * `assertTypedData` check), and it must pay exactly this debt: the same payer
 * (the connected wallet), the debt's amount, the resource and request the
 * voucher names, and the escrow the bundle pins as its `payTo`. A voucher is a
 * payment authorisation — a request for anything else, or for more, would
 * otherwise be one wallet prompt away from being signed.
 */

export const DEBT_SIGNING_REFUSED = "DEBT_SIGNING_REFUSED";

function refuse(detail: string): never {
  throw new Error(`${DEBT_SIGNING_REFUSED}: ${detail}. Nothing was signed.`);
}

/** CAIP-10 `eip155:46630:0xabc…` → its CAIP-2 chain id and address. */
function splitAccount(account: string): { chainId: string; address: string } | null {
  const parts = account.split(":");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { chainId: `${parts[0]}:${parts[1]}`, address: parts[2] };
}

const sameText = (left: unknown, right: string) =>
  typeof left === "string" && left.toLowerCase() === right.toLowerCase();

/**
 * The voucher's `requestHash` as the struct's `bytes32`: `sha256:<hex>`, bare
 * hex or `0x<hex>` — the same reading the backend's EVM adapter applies.
 */
export function requestHashBytes32(value: string): `0x${string}` {
  const hex = value.replace(/^sha256:/, "").replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) refuse("the voucher's request hash is not 32 bytes");
  return `0x${hex.toLowerCase()}`;
}

/**
 * Checks the voucher-intent answer against the debt and the connected wallet
 * and returns the request to sign. Throws `DEBT_SIGNING_REFUSED` otherwise.
 */
export function debtSigningRequest(
  intent: DebtVoucherIntent,
  debt: BuyerDebt,
  signer: Pick<Signer, "address" | "chainId">,
  nowMs: number = Date.now(),
): Omit<Eip155TypedDataRequest, "relayed"> {
  const { voucher, typedData } = intent;
  if (!typedData) refuse("this chain has no wallet signature for a payment voucher");
  if (intent.debt?.intentId !== debt.intentId) refuse("the voucher is for another call");

  const payer = splitAccount(voucher.payer);
  if (!payer || payer.chainId !== signer.chainId || !sameText(payer.address, signer.address)) {
    refuse(`the voucher is made out to ${voucher.payer}, not to the connected wallet`);
  }
  if (!sameText(voucher.payer, debt.payer)) refuse("the voucher's payer is not the debt's payer");
  if (voucher.amount.amount !== debt.amount.amount || !sameText(voucher.amount.asset, debt.amount.asset)) {
    refuse("the voucher's amount is not what the debt owes");
  }
  if (!voucher.resource.startsWith("/mcp/tools/")) refuse("the voucher is not for a tool call");
  if (!Number.isSafeInteger(voucher.expiresAt) || voucher.expiresAt * 1000 <= nowMs) {
    refuse("the voucher has expired; ask for a new one");
  }
  const provider = splitAccount(voucher.provider);
  if (!provider || provider.chainId !== signer.chainId) refuse("the voucher's provider is not on this chain");

  const request: Omit<Eip155TypedDataRequest, "relayed"> = {
    namespace: "eip155",
    chainId: signer.chainId,
    kind: "typed-data",
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  };
  const deployment = assertTypedData(
    request,
    {
      chainId: signer.chainId,
      primaryTypes: ["Voucher"],
      message: {
        payer: signer.address,
        provider: provider.address,
        amount: debt.amount.amount,
        resourceHash: voucherResourceHash(voucher.resource),
        requestHash: requestHashBytes32(voucher.requestHash),
        seq: voucher.seq,
        issuedAt: String(voucher.issuedAt),
        expiresAt: String(voucher.expiresAt),
      },
    },
    DEBT_SIGNING_REFUSED,
  );
  // The voucher pays into the buyer's own escrow: the pinned contract.
  const payTo = splitAccount(voucher.payTo);
  if (!payTo || payTo.chainId !== signer.chainId || !sameText(payTo.address, deployment.escrowContract)) {
    refuse("the voucher does not pay into this app's escrow contract");
  }
  return request;
}

export interface SettleDebtDeps {
  createIntent: (intentId: string) => Promise<DebtVoucherIntent>;
  submit: (intentId: string, body: SettleDebtBody) => Promise<SettleDebtResult>;
  now?: () => number;
}

/** Get the replacement voucher, check it, sign it with the payer's wallet, send it. */
export async function settleDebt(
  debt: BuyerDebt,
  signer: Signer,
  deps: SettleDebtDeps,
): Promise<SettleDebtResult> {
  const intent = await deps.createIntent(debt.intentId);
  const request = debtSigningRequest(intent, debt, signer, deps.now?.() ?? Date.now());
  const signature = await signer.signTypedData(request);
  // The voucher goes back exactly as it was issued, with the signature.
  return deps.submit(debt.intentId, { voucher: intent.voucher, signature });
}
