import type { AccountBlockStatus } from "@/interfaces/account-block";

import { api } from "./api";

/**
 * `GET /account/block-status` — whether the signed-in account is blocked.
 *
 * A `GET`, so a blocked person's session still reaches it: that is the point.
 */
export function getAccountBlockStatus(): Promise<AccountBlockStatus> {
  return api.get<AccountBlockStatus>("/account/block-status");
}
