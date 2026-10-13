import { ApiError } from "@/libs/ApiClient";

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
 *
 * An API that does not have this route yet cannot say, and is read as offering
 * neither.
 */
export async function getPublicFeatures(): Promise<PublicFeatures> {
  try {
    return await api.get<PublicFeatures>("/public/features");
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { reserves: false, demo: false };
    throw error;
  }
}
