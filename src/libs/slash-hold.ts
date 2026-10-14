/**
 * The provider "slash hold", in words (assay-backend
 * `src/modules/provider/domain/slash-hold.ts`).
 *
 * While a provider's penalties cannot be collected on a chain, the router
 * stops sending it paid calls there, and a payment intent naming it there is
 * refused. The hold lifts by itself once the condition clears on two
 * consecutive checks of the chain (about a minute apart).
 *
 * Two refusals carry it:
 *
 *  - `503 TOOL_PROVIDER_SLASH_HOLD`: every provider that could serve the call
 *    is held, so nobody can.
 *  - `409 PAYMENT_PROVIDER_SLASH_HOLD`: the payment's provider is held on its
 *    chain.
 *
 * Pure, and free of React and of any chain SDK, so `ApiClient` can reword the
 * refusals and the provider banner and operator panel can share the reasons.
 */

export const SLASH_HOLD_ERROR_CODES: ReadonlySet<string> = new Set([
  "TOOL_PROVIDER_SLASH_HOLD",
  "PAYMENT_PROVIDER_SLASH_HOLD",
]);

/** Why the provider is held, as the provider reads it ("…, because <this>"). */
const PROVIDER_REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  SLASH_WINDOW_FULL: "today's penalty limit is full and a penalty is waiting",
  STAKE_FULLY_RESERVED: "your stake is fully reserved by pending penalties",
  BONDED_BELOW_MINIMUM: "your stake is below the minimum",
});

/** The same reasons in the third person, for the operator console. */
const OPERATOR_REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  SLASH_WINDOW_FULL: "Daily penalty limit full, a penalty waiting",
  STAKE_FULLY_RESERVED: "Stake fully reserved by pending penalties",
  BONDED_BELOW_MINIMUM: "Stake below the minimum",
});

function lookup(table: Readonly<Record<string, string>>, reason: string): string | null {
  return Object.prototype.hasOwnProperty.call(table, reason) ? table[reason] : null;
}

/** One reason for the provider. An unknown one is named as it came, never guessed at. */
export function providerHoldReasonText(reason: string): string {
  return lookup(PROVIDER_REASON_TEXT, reason) ?? `the chain reports ${reason}`;
}

/** One reason for an operator, with its code kept for a ticket. */
export function operatorHoldReasonText(reason: string): string {
  const text = lookup(OPERATOR_REASON_TEXT, reason);
  return text ? `${text} (${reason})` : reason;
}

/** `["a"]` → `a`; `["a","b"]` → `a and b`; `["a","b","c"]` → `a, b and c`. */
export function joinReasons(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export type SlashHoldAudience = "buyer" | "provider";

/**
 * A slash-hold refusal in words, for whoever is reading it, or `null` for any
 * other code. The buyer is told nothing was paid and to retry; the provider is
 * told it is the one held and where to look.
 */
export function slashHoldErrorText(
  code: string,
  audience: SlashHoldAudience,
  chainName?: string | null,
): string | null {
  const where = chainName ? ` on ${chainName}` : "";
  switch (code) {
    case "TOOL_PROVIDER_SLASH_HOLD":
      return audience === "buyer"
        ? "No provider can take this paid call right now: the providers of this tool are paused while their outstanding penalties are collected. No payment was made. Try again later."
        : `Paid calls are not being routed to you${where}: you are on a slash hold while your penalties cannot be collected. The banner on your console says why and what to do; routing resumes automatically.`;
    case "PAYMENT_PROVIDER_SLASH_HOLD":
      return audience === "buyer"
        ? `This provider is paused${where} while its outstanding penalties are collected, so no payment to it can be made there now. No payment was made. Try again later, or choose another provider or chain.`
        : `Payments to you${where} are paused: you are on a slash hold while your penalties cannot be collected. The banner on your console says why and what to do; it lifts automatically.`;
    default:
      return null;
  }
}

/**
 * Who reads a refusal of this request: the provider console's own routes
 * (`/providers/me/…`) speak to the provider, everything else to the buyer.
 */
export function slashHoldAudienceOf(path: string | null | undefined): SlashHoldAudience {
  const route = (path ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/^\/api\/v\d+/, "");
  return route.startsWith("/providers/me") ? "provider" : "buyer";
}
