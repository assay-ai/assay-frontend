/**
 * `GET /me/status`: the block status, the bell's unread count and the buyer
 * debts in one request, for the whole app under one key. It replaced three
 * polls of their own (`GET /account/block-status`, `GET
 * /notifications/unread-count`, `GET /escrow/debts`), every minute each.
 *
 * A write that changes any of the three invalidates this key.
 */
export const ME_STATUS_KEY = ["me", "status"] as const;
