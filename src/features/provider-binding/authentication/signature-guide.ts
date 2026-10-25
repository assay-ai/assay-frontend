/**
 * What a provider needs to check an Assay signature, in the wizard itself
 * (D23): which headers a call carries, where the public keys are, and a
 * snippet. The full guide lives in the public `assay-ai/assay-provider-verify`
 * repository.
 *
 * The facts mirror the backend signer: Ed25519, HTTP Message Signatures
 * (RFC 9421 style), `Signature` and `Signature-Input` on every call,
 * `Content-Digest` when there is a body, covering the method, the URL,
 * `X-Assay-Call-Id` and the digest, valid for 5 minutes, and made for one
 * provider (`aud`, the provider id): a verifier pins its own id so it refuses
 * requests Assay signed for anyone else. The key set is served at
 * `/.well-known/assay-request-keys.json` on the API host.
 */

/**
 * Shown above the snippet while `@goassay-ai/provider-verify` is not on npm.
 * Set to null once the package is published, and the line goes away.
 */
export const SIGNATURE_PACKAGE_NOTE: string | null = null;

export const SIGNATURE_GUIDE_URL = "https://github.com/assay-ai/assay-provider-verify#readme";

const KEYS_PATH = "/.well-known/assay-request-keys.json";

/**
 * The public key set of the Assay API this console talks to, from its base
 * URL (`https://api.example.com/api/v1` → `https://api.example.com/.well-known/…`).
 * null when the base is not an absolute URL: the snippet then relies on the
 * package's own default.
 */
export function requestKeysUrl(apiBaseUrl: string | undefined): string | null {
  if (!apiBaseUrl) return null;
  try {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${KEYS_PATH}`;
  } catch {
    return null;
  }
}

/** Stands in for the provider id while it loads; never a real id. */
export const PROVIDER_ID_PLACEHOLDER = "YOUR_PROVIDER_ID";

/** An Express example with this provider's id and the key set of this deployment. */
export function signatureSnippet(keysUrl: string | null, providerId: string | null): string {
  const options = [
    `provider: "${providerId ?? PROVIDER_ID_PLACEHOLDER}"`,
    ...(keysUrl ? [`jwksUrl: "${keysUrl}"`] : []),
  ].join(", ");
  return [
    'import { assayVerify } from "@goassay-ai/provider-verify/express";',
    "",
    "// Before any body parser. A call without a valid signature, or one Assay",
    "// signed for another provider, gets 401.",
    `app.use(assayVerify({ ${options} }));`,
  ].join("\n");
}
