import { api } from "./api";

/** Whether this account's receipts open for anyone with the link (`/explorer/call/<id>`). Signed-in only. */
export interface ReceiptPrivacy {
  receiptsPublic: boolean;
}

export async function getReceiptPrivacy(): Promise<ReceiptPrivacy> {
  const body = await api.get<ReceiptPrivacy>("/account/receipt-privacy");
  return { receiptsPublic: body.receiptsPublic === true };
}

export async function updateReceiptPrivacy(receiptsPublic: boolean): Promise<ReceiptPrivacy> {
  const body = await api.put<ReceiptPrivacy>("/account/receipt-privacy", { receiptsPublic });
  return { receiptsPublic: body.receiptsPublic === true };
}
