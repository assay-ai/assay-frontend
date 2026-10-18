import { describe, expect, it } from "vitest";

import {
  alertTitle,
  attentionRows,
  groupAlerts,
  idsToMarkOnOpen,
  isAlertResolved,
  isOldLimitAlert,
  MARK_READ_ATTEMPTS,
  readableBody,
  type AlertNote,
} from "./alert-model";

const ASSET = "eip155:46630/erc20:0xdbbc";
const usd = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

function note(over: Partial<AlertNote> = {}): AlertNote {
  return { id: "n1", event: "velocity.anomaly", title: "Unusual call pattern detected", createdAt: "2026-10-13T17:21:54Z", ...over };
}

describe("groupAlerts", () => {
  it("folds the same alert raised twice in one minute, keeping every id", () => {
    const groups = groupAlerts([
      note({ id: "a", subjectId: "ag1", readAt: "2026-10-14T00:00:00Z" }),
      note({ id: "b", subjectId: "ag1", createdAt: "2026-10-13T17:21:52Z" }),
      note({ id: "c", subjectId: "ag1", createdAt: "2026-10-12T16:30:55Z" }),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([["a", "b"], ["c"]]);
    expect(groups[0]!.unread).toBe(true);
  });
  it("keeps alerts about different agents apart", () => {
    expect(groupAlerts([note({ id: "a", subjectId: "ag1" }), note({ id: "b", subjectId: "ag2" })])).toHaveLength(2);
  });
});

describe("readableBody", () => {
  it("rewrites only the offending tokens of an older body", () => {
    expect(readableBody("Agent f64b7b6e-0d10-4354-b99d-59063875645c sent the same request repeatedly in a short window and has been throttled.")).toBe(
      "Your agent sent the same request repeatedly in a short window and has been throttled.",
    );
    expect(
      readableBody(
        "Agent f64b7b6e-0d10-4354-b99d-59063875645c hit its PROVIDER_PER_AGENT_DAILY limit for a4b9882a-9bc1-4d64-807a-27c0b93daf0a. Resets 2026-10-14T00:00:00.000Z.",
      ),
    ).toBe("Your agent hit its limit for a tool. Resets Oct 14, 00:00 UTC.");
    expect(readableBody("Agent f64b7b6e-0d10-4354-b99d-59063875645c has spent 5.000000 of its 5.000000 daily limit (100%).")).toBe(
      "Your agent has spent $5.00 of its $5.00 daily limit (100%).",
    );
    expect(readableBody("Agent f64b7b6e-0d10-4354-b99d-59063875645c was refused 5 times within an hour calling get_weather (TOOL_NOT_ALLOWED). Nothing was charged.")).toBe(
      "Your agent was refused 5 times within an hour calling get_weather. Nothing was charged.",
    );
  });
  it("keeps the amount and the reassurance in balance and deposit bodies, old or new", () => {
    expect(readableBody("Your available balance is running low (4.900000 USDC). Add funds to avoid interrupted calls.")).toBe(
      "Your available balance is running low ($4.90). Add funds to avoid interrupted calls.",
    );
    expect(readableBody("Your available balance has reached zero (0.000000 USDG). Paid calls will fail until you add funds.")).toBe(
      "Your available balance has reached zero ($0.00). Paid calls will fail until you add funds.",
    );
    expect(readableBody("Your deposit of 20.000000 has been credited and is now spendable.")).toBe(
      "Your deposit of $20.00 has been credited and is now spendable.",
    );
    expect(readableBody("Your deposit of 25.000000 could not be finalized on chain. No balance was affected.")).toBe(
      "Your deposit of $25.00 could not be finalized on chain. No balance was affected.",
    );
  });
  it("leaves the bodies the backend writes now exactly as they are", () => {
    const now = [
      '"My first agent" has spent $5.00 of its $5.00 daily limit (100%).',
      "Your available balance is running low ($4.90). Add funds to avoid interrupted calls.",
      "Your deposit of $25.00 could not be finalized on chain. No balance was affected.",
      "\"research-bot\" reached today's free-call limit for all tools while calling get_weather. Resets Oct 14, 00:00 UTC. Until then, calls to it are paid calls.",
      '"research-bot" was refused 5 times within an hour calling get_weather: the agent may not use this tool. Nothing was charged.',
    ];
    for (const body of now) expect(readableBody(body)).toBe(body);
  });
  it("never treats a quoted key or agent name as a code, so the deadline stays", () => {
    const body = 'Key "CI_DEPLOY" (assay_live_ab12…) of "PROD_BOT" expires Sep 1, 00:00 UTC. Renew it before then.';
    expect(readableBody(body)).toBe(body);
  });
  it("is null only when nothing is left", () => {
    expect(readableBody("  ")).toBeNull();
    expect(readableBody("f64b7b6e-0d10-4354-b99d-59063875645c")).toBe("it");
    expect(readableBody("PROVIDER_PER_AGENT_DAILY")).toBeNull();
  });
});

describe("isAlertResolved", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  const quota = (resetsAt: unknown, limit = "PROVIDER_PER_AGENT_DAILY") =>
    note({ event: "free_quota.exhausted", createdAt: "2026-10-13T17:19:26Z", payload: { resetsAt, limit } });
  it("clears a daily free-quota alert once its reset time has passed", () => {
    expect(isAlertResolved(quota("2026-10-14T00:00:00.000Z"), { now, balances: null })).toBe(true);
    expect(isAlertResolved(quota("2026-10-20T00:00:00.000Z"), { now, balances: null })).toBe(false);
    expect(isAlertResolved(quota(undefined), { now, balances: null })).toBe(false);
  });
  it("never clears the per-minute limit, or a reset inside the alert's own day", () => {
    expect(isAlertResolved(quota("2026-10-13T17:20:26.000Z", "PLATFORM_RATE_LIMIT"), { now, balances: null })).toBe(false);
    expect(isAlertResolved(quota("2026-10-13T17:20:26.000Z"), { now, balances: null })).toBe(false);
  });
  const low = (payload: Record<string, unknown>) => note({ event: "balance.low", payload: { asset: ASSET, ...payload } });
  const balances = (amount: string) => [{ asset: ASSET.toUpperCase(), available: usd(amount) }];
  it("clears a low or zero balance alert only at or above the threshold the alert carries", () => {
    expect(isAlertResolved(low({ threshold: "5000000" }), { now, balances: balances("5000000") })).toBe(true);
    expect(isAlertResolved(note({ event: "balance.zero", payload: { asset: ASSET, threshold: "20000000" } }), { now, balances: balances("13240000") })).toBe(false);
    expect(isAlertResolved(low({ threshold: "20000000" }), { now, balances: balances("19999999") })).toBe(false);
  });
  it("shows the alert when it cannot tell", () => {
    // An older alert without a threshold is never hidden, whatever the balance.
    expect(isAlertResolved(low({}), { now, balances: balances("99000000") })).toBe(false);
    expect(isAlertResolved(low({ threshold: "5000000" }), { now, balances: null })).toBe(false);
    expect(isAlertResolved(low({ threshold: "5000000" }), { now, balances: [{ asset: "other", available: usd("99000000") }] })).toBe(false);
    expect(isAlertResolved(note({ event: "velocity.anomaly" }), { now, balances: [] })).toBe(false);
  });
});

describe("attentionRows (Needs attention)", () => {
  const now = Date.parse("2026-10-19T09:00:00Z");
  const cleared = (i: number) =>
    note({
      id: `q${i}`,
      event: "free_quota.exhausted",
      title: `Free quota exhausted ${i}`,
      createdAt: `2026-10-1${i % 5}T10:00:0${i % 10}Z`,
      payload: { resetsAt: "2026-10-16T00:00:00.000Z", limit: "PROVIDER_PER_AGENT_DAILY" },
    });
  const open = note({ id: "z", event: "balance.zero", title: "Balance reached zero", createdAt: "2026-10-10T00:00:00Z", payload: { asset: ASSET } });

  it("finds an open alert below twenty cleared ones once the list is read to its end", () => {
    const notes = [...Array.from({ length: 20 }, (_, i) => cleared(i)), open];
    const rows = attentionRows(notes, { now, balances: [], dismissed: new Set(), complete: true, shown: 5 });
    expect(rows.shown.map((g) => g.note.id)).toEqual(["z"]);
    expect(rows.countLabel).toBe("1 item");
    expect(rows.more).toBe(false);
  });
  it("never says nothing needs you while the list was not read to its end", () => {
    const notes = Array.from({ length: 20 }, (_, i) => cleared(i));
    const rows = attentionRows(notes, { now, balances: [], dismissed: new Set(), complete: false, shown: 5 });
    expect(rows.shown).toEqual([]);
    expect(rows.more).toBe(true);
    expect(rows.countLabel).toBe("5+ items");
  });
  it("leaves out dismissed and read copies, and brings back a copy whose dismiss failed", () => {
    const a = note({ id: "a", subjectId: "ag1" });
    const b = note({ id: "b", subjectId: "ag1", createdAt: "2026-10-13T17:21:52Z" });
    const both = attentionRows([a, b], { now, balances: [], dismissed: new Set(["a", "b"]), complete: true, shown: 5 });
    expect(both.shown).toEqual([]);
    const oneFailed = attentionRows([a, b], { now, balances: [], dismissed: new Set(["a"]), complete: true, shown: 5 });
    expect(oneFailed.shown.map((g) => g.ids)).toEqual([["b"]]);
    expect(attentionRows([note({ readAt: "2026-10-14T00:00:00Z" })], { now, balances: [], dismissed: new Set(), complete: true, shown: 5 }).shown).toEqual([]);
  });
});

describe("idsToMarkOnOpen (See all alerts)", () => {
  const groups = groupAlerts([
    note({ id: "v", subjectId: "ag1" }),
    note({ id: "z", event: "balance.zero", title: "Balance reached zero" }),
    note({ id: "k", event: "session.expired", title: "Agent credential expired" }),
    note({ id: "w", event: "withdrawal.initiated", title: "Withdrawal requested" }),
    note({ id: "r", event: "deposit.credited", title: "Deposit credited", readAt: "2026-10-14T00:00:00Z" }),
  ]);
  it("marks unread alerts, never an open risk", () => {
    expect(idsToMarkOnOpen(groups, new Map())).toEqual(["v"]);
  });
  it("asks once per id, and retries a failure only once", () => {
    const attempts = new Map<string, number>();
    for (const id of idsToMarkOnOpen(groups, attempts)) attempts.set(id, (attempts.get(id) ?? 0) + 1);
    // A re-render before the list refreshes: the id is still unread, tried once, so one retry.
    expect(idsToMarkOnOpen(groups, attempts)).toEqual(["v"]);
    attempts.set("v", MARK_READ_ATTEMPTS);
    expect(idsToMarkOnOpen(groups, attempts)).toEqual([]);
  });
});

describe("isOldLimitAlert (stale rule)", () => {
  const band = (scope: string, cap: string, subjectId = "ag1") =>
    note({ event: "spend.threshold_crossed", title: "Daily spend at 100%", subjectId, payload: { scope, cap, asset: ASSET } });
  const policy = { dailyCap: usd("5000000"), monthlyCap: usd("100000000") };

  it("marks an alert whose limit has since changed or been removed", () => {
    const ctx = { policy: { dailyCap: usd("2000000"), monthlyCap: null }, policyAgentId: "ag1", delegation: false };
    expect(isOldLimitAlert(band("daily", "5000000"), ctx)).toBe(true);
    expect(isOldLimitAlert(band("monthly", "100000000"), ctx)).toBe(true);
  });
  it("marks a daily alert of an agent that now has its own on-chain limit", () => {
    expect(isOldLimitAlert(band("daily", "5000000"), { policy, policyAgentId: "ag1", delegation: true })).toBe(true);
    expect(isOldLimitAlert(band("monthly", "100000000"), { policy, policyAgentId: "ag1", delegation: true })).toBe(false);
  });
  it("leaves a current limit, another agent, or an unknown policy unmarked", () => {
    expect(isOldLimitAlert(band("daily", "5000000"), { policy, policyAgentId: "ag1", delegation: false })).toBe(false);
    expect(isOldLimitAlert(band("daily", "1", "ag2"), { policy, policyAgentId: "ag1", delegation: false })).toBe(false);
    expect(isOldLimitAlert(band("daily", "1"), { policy: undefined, policyAgentId: "ag1", delegation: false })).toBe(false);
    expect(isOldLimitAlert(note(), { policy, policyAgentId: "ag1", delegation: true })).toBe(false);
  });
  it("marks every band alert once the policy itself is gone", () => {
    expect(isOldLimitAlert(band("monthly", "100000000"), { policy: null, policyAgentId: "ag1", delegation: false })).toBe(true);
  });
  it("says so in the title", () => {
    expect(alertTitle("Daily spend at 100%", true)).toBe("Daily spend at 100% (old limit)");
    expect(alertTitle("Daily spend at 100%", false)).toBe("Daily spend at 100%");
  });
});
