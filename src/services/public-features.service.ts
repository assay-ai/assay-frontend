import { api } from "./api";

/** Which optional public pages this deployment serves. */
export interface PublicFeatures {
  reserves: boolean;
  demo: boolean;
}

/**
 * `GET /public/features` — asked before `/public/reserves` or `/public/demo/*`,
 * which are registered only where they are set up. A page that learned that by
 * calling them fired a failing request on every load.
 */
export function getPublicFeatures(): Promise<PublicFeatures> {
  return api.get<PublicFeatures>("/public/features");
}
