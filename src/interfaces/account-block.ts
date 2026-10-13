/**
 * `GET /account/block-status` — assay-backend
 * `src/modules/account/dto/account-block-status.dto.ts`.
 *
 * What the account holder is told is the fact, the kind and the date. The
 * operator's note is never sent.
 */
export type BlockedRole = "ORGANIZATION" | "PAYER" | "DELEGATE";

export interface AccountBlockStatusEntry {
  /** ORGANIZATION (this tenant), PAYER (its wallet) or DELEGATE (its delegate key). */
  role: BlockedRole;
  subjectKind: "ORGANIZATION" | "WALLET";
  /** The organization id or the CAIP-10 account that is blocked. */
  subject: string;
  /** e.g. `LEAKED_KEY`. */
  reasonCode: string;
  blockedAt: string;
}

export interface AccountBlockStatus {
  /** True when anything in `blocks` applies; every write is then refused. */
  blocked: boolean;
  blocks: AccountBlockStatusEntry[];
}
