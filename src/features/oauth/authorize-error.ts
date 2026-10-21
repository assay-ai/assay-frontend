/**
 * The sentences of `/connect/authorize-error?reason=…` (spec §6.3.4, step 1):
 * the three reasons the MCP host sends, and a general one for anything else.
 */

export const AUTHORIZE_ERROR_COPY = {
  client_unknown: "Assay does not know this app, so it cannot sign in. Check the app's Assay settings and try again.",
  client_metadata_invalid:
    "This app describes itself in a way Assay cannot accept, so it cannot sign in. Contact the app's maker.",
  redirect_uri_mismatch:
    "This app asked to send you back to an address it has not registered, so Assay stopped the sign-in. Nothing was shared.",
} as const;

export const AUTHORIZE_ERROR_FALLBACK = "This sign-in could not start. Go back to your app and try again.";

/** The sentence for a `reason`; anything unknown gets the general one. */
export function authorizeErrorText(reason: string | null): string {
  return reason && Object.hasOwn(AUTHORIZE_ERROR_COPY, reason)
    ? AUTHORIZE_ERROR_COPY[reason as keyof typeof AUTHORIZE_ERROR_COPY]
    : AUTHORIZE_ERROR_FALLBACK;
}
