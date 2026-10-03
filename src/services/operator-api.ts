import ApiClient from "@/libs/ApiClient";
import { getOperatorToken } from "@/libs/operator-session";

/**
 * The client every `operator.service.ts` function uses.
 *
 * A separate instance, not the shared `api`, for two load-bearing reasons:
 *
 *  1. It carries the operator token, not the Privy one.
 *  2. `triggerGlobalUnauthorized: false` keeps a 401 here from firing the
 *     app-wide handler, which clears the Privy session and redirects to
 *     `/login`. An operator token going stale must not sign a buyer out.
 */
export const operatorApi = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL, {
  getToken: getOperatorToken,
  triggerGlobalUnauthorized: false,
});

/*
  Always revalidate. This is not a preference — without it the console lies.

  Every operator GET comes back `Cache-Control: private, max-age=10,
  stale-while-revalidate=3600`. React Query invalidates correctly after an
  action, but the refetch is served out of the BROWSER's HTTP cache: for ten
  seconds from the copy it already has, and under stale-while-revalidate it
  keeps painting the stale body first for up to an hour while it revalidates
  behind the scenes.

  On a read-only screen that is fine. Here the same screen that reads the case
  is the one that just claimed or decided it, so the operator performs an
  action, sees a success toast, and watches the page keep showing the old
  status. That was observed: claim succeeded, the database moved
  DISPUTED -> UNDER_REVIEW, and the header still read DISPUTED until a manual
  reload.

  `no-cache` means revalidate before serving, not "do not cache" — and the
  responses carry an ETag, so an unchanged one costs a 304 rather than a body.
*/
operatorApi.raw().defaults.headers.common["Cache-Control"] = "no-cache";
