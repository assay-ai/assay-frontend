import { describe, expect, it } from "vitest";

import { editDelegationForm } from "@/features/delegation/delegation-form";
import type { UnsettledVouchers } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

import type { EscrowDelegate } from "@/interfaces";

import {
  editIsUnchanged,
  editedToast,
  hasTightenDelay,
  HELD_DEADLINE_MARGIN_SECONDS,
  heldIsStale,
  isUnsettledRefusal,
  liveDelegation,
  loweredDelayedText,
  loweredDelayNote,
  lowersCaps,
  revokeDelayedText,
  revokeDelayNote,
  SETTLE_WAIT_IDLE,
  settleWaitAfterRead,
  strandReasons,
  strandWarning,
  tightenDelayLabel,
  UNSETTLED_WAIT_MAX_MS,
  unsettledLine,
} from "./unsettled";

const ASSET = "eip155:46630/erc20:0xDbbC";
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

/**
 * BUG-D1-07, the D1 retest: W = 5, the chain counter about 2.27, one 0.10
 * payment served and not yet redeemed. Lowering W to 2 signed and landed
 * without a word, and that payment would have been refused by the chain.
 */
const RETEST: UnsettledVouchers = {
  count: 1,
  amount: usdg("100000"),
  largest: usdg("100000"),
  windowNeeds: usdg("2370000"),
  redeemableUntil: "2026-10-12T15:27:11.000Z",
};
const GRANT = { maxVoucherAmount: "500000", maxPerWindow: "5000000", validUntil: "1793000000" };

describe("strandReasons (BUG-D1-07)", () => {
  it("names the window when it is lowered below the counter plus the payment in flight", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxPerWindow: "2000000" })).toEqual([
      "maxPerWindow",
    ]);
  });

  it("lets a lowered window through when it still holds them", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxPerWindow: "2370000" })).toEqual([]);
  });

  it("names a per-payment cap below the largest payment in flight", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxVoucherAmount: "50000" })).toEqual([
      "maxVoucherAmount",
    ]);
  });

  it("names an expiry moved before they can be redeemed", () => {
    const before = String(Date.parse(RETEST.redeemableUntil!) / 1000 - 60);
    expect(strandReasons(RETEST, GRANT, { ...GRANT, validUntil: before })).toEqual([
      "validUntil",
    ]);
  });

  it("always warns on a revoke with payments in flight", () => {
    expect(strandReasons(RETEST, GRANT, "revoke")).toEqual(["revoked"]);
  });

  it("never blocks a raise, nor anything once nothing is in flight", () => {
    expect(
      strandReasons({ ...RETEST, windowNeeds: usdg("9000000") }, GRANT, {
        ...GRANT,
        maxPerWindow: "6000000",
      }),
    ).toEqual([]);
    expect(
      strandReasons({ ...RETEST, count: 0 }, GRANT, { ...GRANT, maxPerWindow: "1" }),
    ).toEqual([]);
    expect(strandReasons(undefined, GRANT, "revoke")).toEqual([]);
  });
});

describe("unsettledLine / strandWarning", () => {
  it("says how many and how much, in full precision", () => {
    expect(unsettledLine(RETEST, "USDG")).toBe("1 payment (0.100000 USDG) still being settled");
    expect(unsettledLine({ ...RETEST, count: 3, amount: usdg("600000") }, "USDG")).toBe(
      "3 payments (0.600000 USDG) still being settled",
    );
    expect(unsettledLine({ ...RETEST, count: 0 }, "USDG")).toBeNull();
  });

  it("says why, and what it costs", () => {
    expect(strandWarning(["maxPerWindow"], 1)).toContain(
      "leave it unredeemable (together they no longer fit the new 24-hour limit)",
    );
    expect(strandWarning(["maxPerWindow"], 1)).toContain("the provider is not paid");
  });
});

describe("isUnsettledRefusal", () => {
  it("recognises the backend's refusal by code", () => {
    expect(
      isUnsettledRefusal(new ApiError("SETTLEMENT_UNSETTLED_VOUCHERS_AT_RISK", "x", 409)),
    ).toBe(true);
    expect(isUnsettledRefusal(new ApiError("SETTLEMENT_RELAYED_INTENT_REFUSED", "x", 409))).toBe(
      false,
    );
    expect(isUnsettledRefusal(new Error("SETTLEMENT_UNSETTLED_VOUCHERS_AT_RISK"))).toBe(false);
  });
});

/**
 * The D1 retest gap: re-submitting the prefilled caps opened the wallet,
 * because "30 days" recomputes the expiry — a signature for nothing. The edit
 * sheet's primary action now waits for a change.
 */
describe("editIsUnchanged", () => {
  const now = Date.parse("2026-10-12T14:40:00Z") / 1000;
  const seeded = editDelegationForm(
    {
      maxVoucherAmount: usdg("500000"),
      maxPerWindow: usdg("2000000"),
      validUntil: "2026-11-11T14:40:00.000Z",
    },
    now,
  );

  it("is unchanged as prefilled, and with the same amounts written differently", () => {
    expect(seeded).toEqual({
      maxVoucherAmount: "0.5",
      maxPerWindow: "2",
      validDays: "30",
      keepExpiry: true,
    });
    expect(editIsUnchanged(seeded, { ...seeded })).toBe(true);
    expect(editIsUnchanged(seeded, { ...seeded, maxVoucherAmount: "0.50 " })).toBe(true);
  });

  it("is changed by any cap or by the expiry", () => {
    expect(editIsUnchanged(seeded, { ...seeded, maxPerWindow: "5" })).toBe(false);
    // While the expiry is kept the days field is not what is signed.
    expect(editIsUnchanged(seeded, { ...seeded, validDays: "29" })).toBe(true);
    expect(editIsUnchanged(seeded, { ...seeded, keepExpiry: false })).toBe(false);
    expect(
      editIsUnchanged(
        { ...seeded, keepExpiry: false },
        { ...seeded, keepExpiry: false, validDays: "29" },
      ),
    ).toBe(false);
    expect(editIsUnchanged(seeded, { ...seeded, maxVoucherAmount: "abc" })).toBe(false);
  });

  it("is never 'unchanged' for a new grant", () => {
    expect(editIsUnchanged(null, seeded)).toBe(false);
  });

  /** Review finding 11: an expired grant seeds "1" day; re-activating it as is must be possible. */
  it("is never 'unchanged' for an expired grant, so it can be re-activated as it was", () => {
    expect(editIsUnchanged(seeded, { ...seeded }, { expired: true })).toBe(false);
  });
});

const DELEGATE = "eip155:46630:0x76B98fD03eE16e2673532769891f1400b447d10C";
function grant(unsettled: UnsettledVouchers | undefined): EscrowDelegate {
  return {
    delegate: DELEGATE,
    maxVoucherAmount: usdg("500000"),
    maxPerWindow: usdg("5000000"),
    spentInWindow: usdg("2270000"),
    validUntil: "2026-11-11T12:33:36.000Z",
    status: "ACTIVE",
    unsettled,
  } as EscrowDelegate;
}
const NONE: UnsettledVouchers = { ...RETEST, count: 0, amount: usdg("0"), windowNeeds: usdg("0") };

/**
 * BUG-D1-08: /agents loaded, the agent paid, Edit limits opened without a
 * reload: the sheet showed the page's list (nothing in flight), no warning, and
 * an enabled "Sign and update". The sheet now reads the grant again when it
 * opens, and only that read counts.
 */
describe("liveDelegation (BUG-D1-08)", () => {
  const pageList = grant(NONE); // what /agents loaded, before the paid call
  const openedAt = 1_000_000;

  it("is not ready to sign until the sheet's own read has answered", () => {
    expect(
      liveDelegation({ opened: pageList, delegate: DELEGATE, list: undefined, readAt: 0, openedAt, failed: false }),
    ).toEqual({ live: pageList, ready: false, gone: false });
    // A read answered BEFORE the sheet opened is the page's, not the sheet's.
    expect(
      liveDelegation({ opened: pageList, delegate: DELEGATE, list: [grant(RETEST)], readAt: openedAt - 1, openedAt, failed: false }).ready,
    ).toBe(false);
  });

  it("opened after a payment without a reload: shows it in flight and warns before Sign", () => {
    const { live, ready } = liveDelegation({
      opened: pageList,
      delegate: DELEGATE,
      list: [grant(RETEST)],
      readAt: openedAt + 250,
      openedAt,
      failed: false,
    });
    expect(ready).toBe(true);
    expect(live?.unsettled?.count).toBe(1);
    expect(unsettledLine(live?.unsettled, "USDG")).toBe(
      "1 payment (0.100000 USDG) still being settled",
    );
    const caps = { maxVoucherAmount: "500000", maxPerWindow: "5000000" };
    // W 5 -> 2 with 2.27 + 0.10 needed: the warning, and Sign stays disabled.
    expect(strandReasons(live?.unsettled, caps, { ...caps, maxPerWindow: "2000000" })).toEqual([
      "maxPerWindow",
    ]);
    // The page's stale list said nothing would strand: the bug.
    expect(strandReasons(pageList.unsettled, caps, { ...caps, maxPerWindow: "2000000" })).toEqual([]);
  });

  it("lets the person on when the read failed (the backend still refuses at build), and spots a vanished key", () => {
    expect(
      liveDelegation({ opened: pageList, delegate: DELEGATE, list: undefined, readAt: 0, openedAt, failed: true }).ready,
    ).toBe(true);
    expect(
      liveDelegation({ opened: pageList, delegate: DELEGATE, list: [], readAt: openedAt + 1, openedAt, failed: false }),
    ).toEqual({ live: null, ready: true, gone: true });
  });
});

/** Review finding 9: the wait unlocked early after a refusal, and never ended for a busy agent. */
describe("settleWaitAfterRead", () => {
  const t0 = 5_000_000;

  it("after a refusal, ignores a read answered before it, even one that says zero", () => {
    const refused = { ...SETTLE_WAIT_IDLE, refusedAt: t0 };
    const stale = settleWaitAfterRead(refused, { count: 0, strands: false, readAt: t0 - 10 }, t0 + 1);
    expect(stale).toBe(refused);
    const fresh = settleWaitAfterRead(refused, { count: 0, strands: false, readAt: t0 + 10 }, t0 + 11);
    expect(fresh).toEqual({ ...SETTLE_WAIT_IDLE, settled: true });
  });

  it("ends the wait once nothing strands any more, not only at zero", () => {
    const waiting = { ...SETTLE_WAIT_IDLE, waiting: true, startedAt: t0 };
    expect(settleWaitAfterRead(waiting, { count: 2, strands: true, readAt: t0 + 5 }, t0 + 5)).toBe(waiting);
    expect(settleWaitAfterRead(waiting, { count: 1, strands: false, readAt: t0 + 10 }, t0 + 10)).toEqual({
      ...SETTLE_WAIT_IDLE,
      settled: true,
    });
  });

  it("gives up with 'stalled' when the agent keeps paying, and does nothing when idle", () => {
    const waiting = { ...SETTLE_WAIT_IDLE, waiting: true, startedAt: t0 };
    const later = t0 + UNSETTLED_WAIT_MAX_MS;
    expect(settleWaitAfterRead(waiting, { count: 3, strands: true, readAt: later }, later)).toMatchObject({
      waiting: false,
      stalled: true,
      settled: false,
    });
    expect(settleWaitAfterRead(SETTLE_WAIT_IDLE, { count: 0, strands: false, readAt: t0 }, t0)).toBe(
      SETTLE_WAIT_IDLE,
    );
  });
});

/** Review finding 8: the held signed request goes stale with its deadline or its nonce. */
describe("heldIsStale", () => {
  const now = 1_793_000_000;
  const held = { nonce: "26", deadline: String(now + 300), validUntil: "1795000000" };

  it("is usable while its deadline is ahead and its nonce is the current one", () => {
    expect(heldIsStale(held, now)).toBeNull();
    expect(heldIsStale(held, now, "26")).toBeNull();
  });

  it("is stale near its deadline, or once another change used the nonce up", () => {
    expect(heldIsStale(held, now + 300 - HELD_DEADLINE_MARGIN_SECONDS)).toBe("deadline");
    expect(heldIsStale({ ...held, deadline: undefined }, now)).toBe("deadline");
    expect(heldIsStale(held, now, "27")).toBe("nonce");
  });
});

// BUG-R3-J-04: lowering a cap pauses the agent's payments for about 30 s, and
// the toast said only "The new caps apply from the agent's next payment."
describe("editedToast", () => {
  const current = { maxVoucherAmount: "500000", maxPerWindow: "3000000", validUntil: "1794397106" };

  it("says payments are paused briefly when a cap goes down", () => {
    expect(editedToast(current, { ...current, maxVoucherAmount: "40000" })).toBe(
      "Updated. The agent’s payments are paused for about 30 seconds while the change settles; then the new caps apply.",
    );
    expect(editedToast(current, { ...current, validUntil: "1794000000" })).toMatch(/paused for about 30 seconds/);
  });

  it("promises the next payment only when nothing was lowered", () => {
    expect(editedToast(current, { ...current, maxPerWindow: "5000000" })).toBe(
      "Updated. The new caps apply from the agent’s next payment.",
    );
    expect(editedToast(null, current)).toBe(
      "Updated. The new caps apply from the agent’s next payment.",
    );
  });
});

// assay-evm D-21: on an escrow with the tighten delay, a tightening binds
// signed payments only after `tightenDelaySeconds`, so nothing is stranded.
describe("tighten delay (D-21)", () => {
  it("strands nothing when tightenDelaySeconds is above 0", () => {
    expect(strandReasons(RETEST, GRANT, { ...GRANT, maxPerWindow: "2000000" }, 3600)).toEqual([]);
    expect(strandReasons(RETEST, GRANT, "revoke", 3600)).toEqual([]);
  });

  it("keeps the strict reading at 0 or when the API leaves it out", () => {
    expect(strandReasons(RETEST, GRANT, "revoke", 0)).toEqual(["revoked"]);
    expect(strandReasons(RETEST, GRANT, "revoke", undefined)).toEqual(["revoked"]);
    expect(hasTightenDelay(0)).toBe(false);
    expect(hasTightenDelay(null)).toBe(false);
    expect(hasTightenDelay(3600)).toBe(true);
  });

  it("says the delay in words", () => {
    expect(tightenDelayLabel(3600)).toBe("1 hour");
    expect(tightenDelayLabel(7200)).toBe("2 hours");
    expect(tightenDelayLabel(1800)).toBe("30 minutes");
    expect(revokeDelayedText(3600)).toBe(
      "Vouchers your agent already signed stay collectable for 1 hour, so providers you already used get paid. New paid calls stop now.",
    );
    expect(loweredDelayedText(3600)).toBe(
      "Lower limits apply to already-signed vouchers after 1 hour.",
    );
  });

  it("tells a lowering from a raise", () => {
    expect(lowersCaps(GRANT, { ...GRANT, maxVoucherAmount: "1" })).toBe(true);
    expect(lowersCaps(GRANT, { ...GRANT, validUntil: "1792000000" })).toBe(true);
    expect(lowersCaps(GRANT, { ...GRANT, maxPerWindow: "9000000" })).toBe(false);
    expect(lowersCaps(GRANT, { maxVoucherAmount: "500000", maxPerWindow: "5000000" })).toBe(false);
  });

  it("drops the 30-second pause from the edit toast", () => {
    const toast = editedToast(GRANT, { ...GRANT, maxVoucherAmount: "40000" }, 3600);
    expect(toast).not.toMatch(/paused/);
    expect(toast).toMatch(/after 1 hour/);
    expect(editedToast(GRANT, { ...GRANT, maxPerWindow: "9000000" }, 3600)).toBe(
      "Updated. The new caps apply from the agent’s next payment.",
    );
  });

  it("picks the Revoke sheet's wording by the delay", () => {
    expect(revokeDelayNote(3600)).toBe(revokeDelayedText(3600));
    expect(revokeDelayNote(0)).toBeNull();
    expect(revokeDelayNote(undefined)).toBeNull();
  });

  it("says when lower limits apply only for a lowering on a delayed escrow", () => {
    const lower = { ...GRANT, maxPerWindow: "1" };
    expect(loweredDelayNote(3600, GRANT, lower)).toBe(
      "Lower limits apply to already-signed vouchers after 1 hour.",
    );
    expect(loweredDelayNote(3600, GRANT, { ...GRANT, maxPerWindow: "9000000" })).toBeNull();
    expect(loweredDelayNote(0, GRANT, lower)).toBeNull();
    expect(loweredDelayNote(3600, null, lower)).toBeNull();
  });
});
