import { describe, expect, it } from "vitest";

import type { ToolCall } from "@/services";
import type { VerdictRow } from "@/services/guarantee.service";

import { foldReasons } from "./use-guarantee";
import { reconcileState } from "./reconcile-note";
import type { WithheldForAsset } from "./wire";

const money = (amount: string) => ({ amount, asset: "x", decimals: 6 });
const call = (status: string, verdict: string | null, price = "50000", id = Math.random().toString()): ToolCall =>
  ({ intentId: id, toolId: "t", providerId: "p", status, price: money(price), charged: money(status === "SETTLED" ? price : "0"), verdict, createdAt: "" }) as ToolCall;

describe("foldReasons", () => {
  it("covers every not-charged call under its real reason, not only those with a verdict", () => {
    const calls = [
      call("REFUNDED", "FAIL", "50000", "a"),
      call("REFUNDED", "FAIL", "20000", "b"),
      call("REFUNDED", null),
      call("VOIDED", null),
      call("VOIDED", null),
      call("EXPIRED", null),
      call("VOIDED", "MISAPPLIED"),
      call("SETTLED", "PASS"),
    ];
    const verdicts = [
      { intentId: "a", reasonCode: "quorum_failures_at_least" },
      { intentId: "b", reasonCode: "stale_data" },
    ] as VerdictRow[];
    const rows = foldReasons(verdicts, calls);
    expect(rows.reduce((n, r) => n + r.calls, 0)).toBe(7);
    const byKey = Object.fromEntries(rows.map((r) => [r.reason, r]));
    expect(byKey.NO_USABLE_RESULT?.calls).toBe(2);
    expect(byKey.WRONG_FORMAT?.label).toBe("Result in the wrong format");
    expect(byKey.EXPIRED?.label).toBe("Did not finish in time");
    expect(byKey.FAILED_CHECKS?.label).toBe("Failed our checks");
    expect(byKey["FAIL:stale_data"]?.label).toMatch(/^Failed our checks: /);
    expect(byKey.MISAPPLIED).toBeDefined();
  });

  it("nests every reason under its line, so failed checks count the same everywhere", () => {
    const forfeited = { ...call("SETTLED", "PASS"), charged: money("0"), forfeited: true } as ToolCall;
    const voidedDebt = { ...call("SETTLED", "FAIL"), charged: money("0"), debt: "VOIDED" } as ToolCall;
    const owed = { ...call("SETTLED", "PASS"), charged: money("0"), debt: "OUTSTANDING" } as ToolCall;
    const calls = [
      call("REFUNDED", "FAIL", "50000", "a"),
      call("REFUNDED", null),
      call("VOIDED", null),
      call("EXPIRED", null),
      forfeited,
      voidedDebt,
      owed,
      call("SETTLED", "PASS"),
    ];
    const rows = foldReasons([{ intentId: "a", reasonCode: "stale_data" }] as VerdictRow[], calls);
    const perBucket = (bucket: string) =>
      rows.filter((r) => r.bucket === bucket).reduce((n, r) => n + r.calls, 0);
    // Wrong format is a refund: it sits under "Failed our checks (incl. wrong format)".
    expect(perBucket("FAILED_VERIFICATION")).toBe(2);
    expect(perBucket("PROVIDER_OR_PLATFORM_ERROR")).toBe(2);
    // An owed call and a charged one are not "not charged".
    expect(perBucket("NOT_COLLECTED")).toBe(2);
    expect(rows.find((r) => r.reason === "FORFEITED")?.label).toBe("The provider forfeited the payment");
    // A late FAIL that voided a debt is not collected, not a refund.
    expect(rows.find((r) => r.reason === "DEBT_VOIDED")?.bucket).toBe("NOT_COLLECTED");
    expect(rows.some((r) => r.reason === "FAILED_CHECKS")).toBe(false);
  });

  it("tells a refund won by a report as that, never as a late check result", () => {
    const upheld = { ...call("SETTLED", "PASS"), charged: money("0"), debt: "VOIDED", refundedByReport: true } as ToolCall;
    const [row] = foldReasons([], [upheld]);
    expect(row).toMatchObject({
      reason: "REFUNDED_BY_REPORT",
      label: "Refunded after your report was upheld",
      bucket: "NOT_COLLECTED",
      calls: 1,
    });
  });
});

describe("reconcileState", () => {
  const w = (ok: boolean, difference: string) => ({ ok, difference }) as WithheldForAsset;
  it("tells money returned apart from money missing", () => {
    expect(reconcileState(w(true, "0"))).toBe("matches");
    expect(reconcileState(w(false, "500000"))).toBe("more-released");
    expect(reconcileState(w(false, "-1"))).toBe("less-released");
    expect(reconcileState(null)).toBe("unknown");
  });
});
