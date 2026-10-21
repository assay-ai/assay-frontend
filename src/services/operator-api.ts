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
 *
 * It sends no `Cache-Control` request header. It used to send `no-cache` on
 * every request, from when operator GETs came back `private, max-age=10,
 * stale-while-revalidate=3600` and the refetch after an action was served the
 * pre-action body out of the browser's HTTP cache. Every `/operator/*` GET is
 * now answered `private, no-cache` (BUG-SYS-01; no operator route opts in with
 * `@CacheHeader`), so the browser revalidates each read with `If-None-Match`
 * before using it and an unchanged body costs a 304. The request header added
 * nothing to that.
 */
export const operatorApi = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL, {
  getToken: () => getOperatorToken(),
  triggerGlobalUnauthorized: false,
  onUnauthorized: handleOperatorUnauthorized,
});
