import ApiClient, { type ApiError } from "@/libs/ApiClient";
import { clearOperatorSession, getOperatorToken } from "@/libs/operator-session";

/**
 * What a 401 on an operator call means.
 *
 * On the sign-in routes it is a refused signature or message, which the
 * sign-in screen reports itself — there is no session to end yet. Anywhere
 * else it is the session: expired, revoked (an operator removed in the
 * directory loses every session at once) or unknown. The session is dropped
 * and the shell, which subscribes to it, goes back to sign-in.
 */
export function handleOperatorUnauthorized(_error: ApiError, url: string): void {
  if (url.startsWith("/operator/auth/")) return;
  clearOperatorSession("expired");
}

/**
 * The client every `operator.service.ts` function uses.
 *
 * A separate instance, not the shared `api`, for two load-bearing reasons:
 *
 *  1. It carries the operator session token, not the Privy one.
 *  2. `triggerGlobalUnauthorized: false` keeps a 401 here from firing the
 *     app-wide handler, which clears the Privy session and redirects to
 *     `/login`. An operator session going stale must not sign a buyer out.
 */
export const operatorApi = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL, {
  getToken: () => getOperatorToken(),
  triggerGlobalUnauthorized: false,
  onUnauthorized: handleOperatorUnauthorized,
});

/*
  Always revalidate. This is not a preference — without it the console lies.

  Every operator GET comes back `Cache-Control: private, max-age=10,
  stale-while-revalidate=3600`. React Query invalidates correctly after an
  action, but the refetch is served out of the BROWSER's HTTP cache: for ten
  seconds from the copy it already has, and under stale-while-revalidate it
  keeps painting the stale body first for up to an hour while it revalidates
  behind the scenes.

  `no-cache` means revalidate before serving, not "do not cache" — and the
  responses carry an ETag, so an unchanged one costs a 304 rather than a body.
*/
operatorApi.raw().defaults.headers.common["Cache-Control"] = "no-cache";
