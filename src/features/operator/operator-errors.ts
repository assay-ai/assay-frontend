import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";

/** What a cancel answers when nothing of the penalty stands on chain (409 SLASH_NOTHING_STANDING). */
export const NOTHING_ON_CHAIN = "Nothing is on chain: nothing can be executed, and there is nothing to sign.";

/**
 * Any operator action's refusal as one plain sentence — never the code, which
 * screens show under "Details". Codes specific to one screen (blocks, arbiter,
 * approvals, directory) have their own wording there; this is the fallback
 * and the case page's voice.
 */
const SENTENCES: Readonly<Record<string, string>> = {
  OPERATOR_AUTHORITY_EXCEEDED: "The amount is above your authority limit. An operator with a higher limit has to do this.",
  OPERATOR_ROLE_REQUIRED: "Your roles do not allow this action.",
  OPERATOR_CREDENTIAL_INVALID: "Your operator session has ended. Sign in again.",
  OPERATOR_SUSPENDED: "Your operator account is suspended.",
  OPERATOR_NOT_AUTHORIZED: "This wallet is no longer an active operator.",
  OPERATOR_SECOND_APPROVER_REQUIRED: "This needs a second operator, who approves it from their Home.",
  OPERATOR_OVERRIDE_NOT_IMPLEMENTED: "The backend does not have this action switched on yet.",
  CHAIN_ARBITER_NOT_SET: "No arbiter is appointed on this chain, so the transaction cannot be built. The admin appoints one first.",
  CHAIN_PROGRAM_PAUSED: "The contracts are paused. Try again after they are unpaused.",
  SLASH_NOTHING_STANDING: NOTHING_ON_CHAIN,
  NETWORK_ERROR: "Assay could not be reached. Check your connection and try again.",
  ECONNABORTED: "Assay took too long to answer. Check the page before you try again.",
};

export function operatorErrorSentence(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "SLASH_CHAIN_UNAVAILABLE") return chainUnavailableSentence(error);
    if (error.code === "SLASH_NOTHING_STANDING") return nothingStandingOutcome(error).next;
    if (SENTENCES[error.code]) return SENTENCES[error.code]!;
    if (error.status === 409) return "This penalty changed in the meantime, so nothing was done. Reload it and try again.";
    if (error.status === 422 || error.code === "VALIDATION_FAILED") return "Some details were not accepted. Check the form and try again.";
    return plainError(error.code);
  }
  if (error instanceof Error && error.message) return error.message.split("\n")[0]!;
  return "That did not go through. Nothing changed; you can try again.";
}

/**
 * `SLASH_CHAIN_UNAVAILABLE`: the backend's own reason (`error.context.reason`,
 * else parsed from the message), never a guess about configuration. Pure.
 */
export function chainUnavailableSentence(error: Pick<ApiError, "message" | "context">): string {
  const fromContext = typeof error.context?.reason === "string" ? error.context.reason : null;
  const reason = fromContext ?? /could be built for this case: (.+?)\. Nothing was/.exec(error.message)?.[1]?.trim();
  return reason ? `The transaction could not be built: ${reason}.` : "The transaction could not be built.";
}

/**
 * What a 409 `SLASH_NOTHING_STANDING` means, from its context's `chainStatus`
 * (what the backend's chain read showed). The backend changes nothing. An
 * EXECUTED record is money taken: an alert, never "nothing". Pure.
 */
export function nothingStandingOutcome(error: Pick<ApiError, "context">): { title: string; next: string; alert: boolean } {
  const chainStatus = typeof error.context?.chainStatus === "string" ? error.context.chainStatus : null;
  if (chainStatus === "EXECUTED") {
    return {
      title: "Executed on chain while the cancel waited",
      next: "The stake was taken: the penalty was executed on chain before the cancel landed, so nothing can be cancelled. Operations has been alerted.",
      alert: true,
    };
  }
  if (chainStatus === "NOT_FOUND") {
    return {
      title: "No record of this penalty is found on chain",
      next: "There is nothing to sign, and nothing was changed. If a record was written earlier, someone should check where it went.",
      alert: false,
    };
  }
  if (chainStatus === "PROPOSING") {
    return {
      title: "Part of this penalty may still land on chain",
      next: "Nothing stands now, but a part is still being proposed. Nothing was changed; try again later.",
      alert: false,
    };
  }
  return { title: "Nothing is on chain to cancel", next: `${NOTHING_ON_CHAIN} Nothing was changed.`, alert: false };
}

/**
 * A list that failed to load, in one sentence. A `VALIDATION_FAILED` on a list
 * the console asked for itself is the console's fault, not the operator's:
 * it says so, with the request and when, so it can be reported and found.
 * Pure.
 */
export function listLoadError(error: unknown, what: string, now: Date = new Date()): string {
  if (error instanceof ApiError && error.code === "VALIDATION_FAILED") {
    const at = `${now.toISOString().slice(11, 16)} UTC`;
    return `${what} could not be loaded. This is a bug on our side; please report it (request ${error.path ?? "unknown"} at ${at}).`;
  }
  return `${what} could not be loaded.`;
}
