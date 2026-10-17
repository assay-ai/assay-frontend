/**
 * The dispute upgrade's unsigned contract calls (assay-evm D-19), as the
 * backend serves them.
 *
 * Mirrors assay-backend `SlashContractCallDto`
 * (`src/modules/slash/dto/slash-dispute-intent.dto.ts`) and `SlashIdRefusal`
 * (`src/modules/slash/ports/slash-dispute-intent.port.ts`). Served by
 * `POST /providers/me/slash-requests/dispute-intent` (the provider's
 * `disputeSlashBatch`) and `POST /operator/arbiter/ruling-intent` /
 * `block-intent` (the arbiter's `upholdSlashBatch`, `cancelSlashBatch`,
 * `setBlocked`). The backend builds; a person's wallet signs and sends.
 */

/** Who must sign a built call. */
/** `ADMIN` only for the config calls Contracts builds in the browser; the backend names the other two. */
export type SlashCallSignerRole = "PROVIDER" | "ARBITER" | "ADMIN";

export interface SlashContractCall {
  /** CAIP-2, e.g. `eip155:46630`. */
  chainId: string;
  /** The contract (proxy) to send to. */
  to: string;
  /** ABI-encoded calldata, `0x`-hex. Unsigned. */
  data: string;
  /** Always `"0"`: none of these doors takes value. */
  value: string;
  /** The only account the contract accepts this call from, checksummed. */
  signer: string;
  signerRole: SlashCallSignerRole;
  /** `disputeSlashBatch`, `upholdSlashBatch`, `cancelSlashBatch` or `setBlocked`. */
  functionName: string;
  /** `0x` + lower-case hex, in calldata order. Empty for `setBlocked`. */
  requestIds: string[];
}

/** `POST /providers/me/slash-requests/dispute-intent`. 1 to 64 ids. */
export interface DisputeSlashRequestsBody {
  chainId: string;
  requestIds: string[];
}

/** Why the chain would refuse one id of an atomic batch: the contract's own error name. */
export type SlashIdRefusalReason =
  | "NoSuchRecord"
  | "DuplicateId"
  | "NotSlashedProvider"
  | "SlashNotPending"
  | "DisputeWindowClosed"
  | "SlashNotDisputed"
  | "DisputeTimedOut"
  | "SlashAlreadyDisputed";

export interface SlashIdRefusal {
  /** `0x` + lower-case hex. */
  requestId: string;
  /** One of {@link SlashIdRefusalReason}, or a name a newer backend added. */
  reason: string;
  /** The backend's own sentence, when it was sent. */
  detail?: string;
}
