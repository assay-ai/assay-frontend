import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";

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
  SLASH_CHAIN_UNAVAILABLE: "The backend has no settlement contracts configured for this chain.",
  NETWORK_ERROR: "Assay could not be reached. Check your connection and try again.",
  ECONNABORTED: "Assay took too long to answer. Check the page before you try again.",
};

export function operatorErrorSentence(error: unknown): string {
  if (error instanceof ApiError) {
    if (SENTENCES[error.code]) return SENTENCES[error.code]!;
    if (error.status === 409) return "This penalty changed in the meantime, so nothing was done. Reload it and try again.";
    if (error.status === 422 || error.code === "VALIDATION_FAILED") return "Some details were not accepted. Check the form and try again.";
    return plainError(error.code);
  }
  if (error instanceof Error && error.message) return error.message.split("\n")[0]!;
  return "That did not go through. Nothing changed; you can try again.";
}
