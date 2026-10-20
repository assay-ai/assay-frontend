import ApiClient from "@/libs/ApiClient";

/**
 * The client for the API's `/public/*` routes, which never sends a token.
 *
 * A separate instance, not the shared `api`, because of what a token does to
 * caching. Those routes answer the same body to everyone, and Cloudflare keeps
 * them for a minute so a busy page reaches the API about once a minute. But the
 * API answers any request that carries `Authorization` as `private` with
 * `CDN-Cache-Control: no-store` — the shared cache must never hold a response
 * to a signed-in request — so with the shared client every signed-in visitor
 * of the Explorer missed the edge and reached the origin, and none of their
 * loads could fill it.
 *
 * Nothing under `/public` reads a token, so leaving it off loses nothing, and
 * one more place stops receiving the session token it has no use for.
 *
 * `triggerGlobalUnauthorized: false`: a public route has no session to end, so
 * nothing it answers may sign a buyer out.
 */
export const publicApi = new ApiClient(process.env.NEXT_PUBLIC_API_BASE_URL, {
  getToken: () => null,
  triggerGlobalUnauthorized: false,
});
