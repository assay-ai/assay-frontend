import type { SlashIdRefusal } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { contractErrorText } from "@/libs/chains/evm/contract-errors";

/**
 * `422 SLASH_CHAIN_BATCH_REFUSED`: the batch is atomic on chain, so the backend
 * reads every record first and, when one id would revert the whole batch,
 * builds nothing and names each such id with the contract's own error.
 *
 * ## Where the refusals come from
 *
 * The backend sends them as `error.context` (`publicContext: ['functionName',
 * 'refusals']` on `SlashErrors.chainBatchRefused`): `refusals` is a list of
 * `{ requestId, reason, detail }`, `requestId` bare hex, and `functionName`
 * the batch it would revert. That is read first. The message carries the same
 * list, `"… revert the whole upholdSlashBatch; nothing was built: 0x<64 hex>
 * (SlashNotPending), …"`, and is parsed only as a fallback, for a backend
 * that does not send the context.
 */

const REFUSAL_IN_MESSAGE = /0x([0-9a-fA-F]{64})\s*\(([A-Za-z]+)\)/g;
const FUNCTION_IN_MESSAGE = /revert the whole ([A-Za-z][A-Za-z0-9]*);/;

function normaliseId(id: string): string {
  const bare = id.trim().toLowerCase().replace(/^0x/, "");
  return `0x${bare}`;
}

/** The refusals in a `SLASH_CHAIN_BATCH_REFUSED`, or `null` for any other error. */
export function refusalsOf(error: unknown): SlashIdRefusal[] | null {
  if (!(error instanceof ApiError) || error.code !== "SLASH_CHAIN_BATCH_REFUSED") return null;

  const fromContext = error.context?.refusals;
  if (Array.isArray(fromContext)) {
    const parsed = fromContext.flatMap((entry): SlashIdRefusal[] => {
      if (!entry || typeof entry !== "object") return [];
      const { requestId, reason, detail } = entry as Record<string, unknown>;
      if (typeof requestId !== "string" || typeof reason !== "string") return [];
      return [
        { requestId: normaliseId(requestId), reason, ...(typeof detail === "string" ? { detail } : {}) },
      ];
    });
    if (parsed.length > 0) return parsed;
  }

  const out: SlashIdRefusal[] = [];
  for (const match of error.message.matchAll(REFUSAL_IN_MESSAGE)) {
    out.push({ requestId: normaliseId(match[1]), reason: match[2] });
  }
  return out;
}

/**
 * The batch a `SLASH_CHAIN_BATCH_REFUSED` would have reverted
 * (`disputeSlashBatch`, `upholdSlashBatch`, `cancelSlashBatch`), from
 * `context.functionName`, else from the message; `null` for any other error.
 */
export function refusedFunctionOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== "SLASH_CHAIN_BATCH_REFUSED") return null;
  const fromContext = error.context?.functionName;
  if (typeof fromContext === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(fromContext)) return fromContext;
  return FUNCTION_IN_MESSAGE.exec(error.message)?.[1] ?? null;
}

/** Who is reading: the provider about their own penalties, or the arbiter's operator. */
export type RefusalAudience = "provider" | "arbiter";

/** One refusal reason in plain words. An unknown name is shown as the chain's. */
export function refusalReasonText(reason: string, audience: RefusalAudience): string {
  switch (reason) {
    case "NoSuchRecord":
      return "There is no penalty with this id on chain.";
    case "DuplicateId":
      return "This penalty was selected twice; each can go into the batch once.";
    case "NotSlashedProvider":
      return audience === "provider"
        ? "This penalty is against another wallet, not your stake wallet, so you cannot dispute it."
        : "This penalty is against another provider.";
    case "SlashNotPending":
      return audience === "provider"
        ? "This penalty is no longer pending: it was already disputed, executed or cancelled."
        : "This penalty is no longer open: it was already executed or cancelled.";
    case "DisputeWindowClosed":
      return "The dispute window has closed: this penalty can already be executed.";
    case "SlashNotDisputed":
      return "This penalty is not disputed on chain, so there is nothing to uphold. Cancel it instead, or leave it.";
    case "SlashAlreadyDisputed":
      return audience === "provider"
        ? "You already disputed this penalty once; a penalty can be disputed only one time."
        : "This penalty was already disputed once; a penalty can be disputed only one time.";
    default:
      // `DisputeTimedOut` and the other contract errors with a sentence.
      return contractErrorText(reason) ?? `The chain would refuse this id (${reason}).`;
  }
}

/** Request id (lower-case, `0x`) → the plain-words reasons for it. */
export function refusalsById(
  refusals: readonly SlashIdRefusal[],
  audience: RefusalAudience,
): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, string[]>();
  for (const refusal of refusals) {
    const id = normaliseId(refusal.requestId);
    const text = refusalReasonText(refusal.reason, audience);
    const list = out.get(id);
    if (list) {
      if (!list.includes(text)) list.push(text);
    } else {
      out.set(id, [text]);
    }
  }
  return out;
}
