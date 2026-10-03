/**
 * The operator console's bearer token.
 *
 * A second, deliberately separate authentication path — `OperatorAuthGuard` on
 * the backend, not Privy. Its own storage key, so that signing out of the buyer
 * app does not clear it and vice versa, and so neither token can be presented
 * where the other is expected.
 *
 * Mirrors the Privy accessors in `ApiClient.ts` exactly, including the SSR guard
 * and the swallowed storage errors: this module is imported by
 * `src/services/operator-api.ts`, which a Server Component may reach.
 */
const OPERATOR_TOKEN_KEY = "operatorAccessToken";

export function getOperatorToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(OPERATOR_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setOperatorToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OPERATOR_TOKEN_KEY, token);
  } catch {
    /* storage disabled; the request will 401 and the shell re-prompts */
  }
}

export function clearOperatorToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OPERATOR_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}
