import { describe, expect, it } from "vitest";

import { collapseNotices } from "@/features/provider-home/inbox";

import { inboxView, notificationHref, type NotificationItem } from "./inbox-item";

const NOW = Date.parse("2026-10-18T12:00:00Z");
const names = { toolName: (bindingId: string | null | undefined) => (bindingId === "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc" ? "get_weather" : null), now: NOW };

function row(partial: Partial<NotificationItem> & Pick<NotificationItem, "event" | "title" | "body">): NotificationItem {
  return {
    id: partial.id ?? "n1",
    severity: "CRITICAL",
    subjectType: null,
    subjectId: null,
    readAt: null,
    payload: {},
    createdAt: "2026-10-15T10:00:00Z",
    ...partial,
  };
}

/** No minor units, no UUIDs, no 6-decimal figures, no ISO timestamps. */
function expectReadable(text: string) {
  expect(text).not.toMatch(/\b\d{5,}\b/);
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  expect(text).not.toMatch(/\d\.\d{6}\b/);
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
}

describe("inboxView: stored rows read from event + payload", () => {
  it("renders the legacy \"40000 was taken\" row in dollars, with what left the stake", () => {
    const view = inboxView(
      row({
        event: "provider.slash_executed",
        title: "40000 was taken from your stake",
        body: "The proposal was upheld and the timelock has elapsed. The case page has the detail.",
        subjectType: "slash_proposal",
        subjectId: "b5c6dab1-fcda-4f85-85bc-fc2174b74654",
        payload: { applied: "40000", requested: "40000", signature: null, proposalId: "b5c6dab1-fcda-4f85-85bc-fc2174b74654" },
      }),
      names,
    );
    expect(view.title).toBe("$0.04 penalty was executed");
    expect(view.body).toBe(
      "You lost $0.036 of your stake: $0.024 to the buyers whose calls failed and $0.012 to Assay. The other $0.004 is never taken.",
    );
    expect(view.target?.href).toBe("/provider/penalties?case=b5c6dab1-fcda-4f85-85bc-fc2174b74654");
    expectReadable(view.title);
    expectReadable(view.body);
  });

  it("names the tool when the payload carries it", () => {
    const view = inboxView(
      row({ event: "provider.slash_executed", title: "x", body: "y", payload: { applied: "40000", decimals: 6, toolName: "get_weather" } }),
      names,
    );
    expect(view.title).toBe("$0.04 penalty on get_weather was executed");
  });

  it("renders the legacy headroom row by tool and in dollars, with Add stake", () => {
    const view = inboxView(
      row({
        event: "provider.stake_headroom_low",
        severity: "WARNING",
        title: "Stake headroom is running low",
        body: "Binding 1fbd249d-d4a5-4f33-aa21-6aa69487b2fc is within 20% of its 100.000000 stake floor (staked: 119.955000). Top up now to avoid a grace period.",
        subjectType: "binding",
        subjectId: "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc",
        payload: { asset: "eip155:46630/erc20:0xDb", staked: "119955000", required: "100000000", bindingId: "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc" },
      }),
      names,
    );
    expect(view.title).toBe("get_weather: your stake ($119.95) is within $20.00 of the $100.00 minimum");
    expect(view.body).not.toMatch(/binding|floor|grace/i);
    expect(view.target).toEqual({ href: "/provider/capital?sheet=stake", label: "Add stake" });
    expectReadable(view.title);
    expectReadable(view.body);
  });

  it("renders a legacy proposed penalty without minor units or an ISO time", () => {
    const view = inboxView(
      row({
        event: "provider.slash_proposed",
        title: "A penalty of 28470000 is proposed against your stake",
        body: "Nothing executes before 2026-10-18T19:14:37.507Z, even if you do nothing.",
        payload: { penaltyAmount: "28470000", assetId: "solana:x/token:y", earliestExecutionAt: "2026-10-18T19:14:37.507Z", bindingId: "b-unknown" },
      }),
      names,
    );
    expect(view.title).toBe("A penalty of up to $28.47 is proposed against your stake");
    expect(view.body).toContain("Nothing is taken before today 19:14 UTC.");
    expectReadable(view.body);
  });

  it("explains a cancellation and folds a run of them into one notice", () => {
    const cancelled = (id: string, createdAt: string) =>
      row({
        id,
        createdAt,
        event: "provider.slash_decided",
        title: "A proposed penalty against your stake was cancelled",
        body: "The penalty could not be applied on chain, so it is cancelled and nothing was taken. Any stake it had reserved is released.",
        payload: { chainError: null, proposalId: id, reservationHeldUntil: null },
      });
    const items = [cancelled("a", "2026-10-15T12:00:00Z"), cancelled("b", "2026-10-15T11:00:00Z"), cancelled("c", "2026-10-15T10:00:00Z")];
    const folded = collapseNotices(
      items.map((item) => ({ ...item, view: inboxView(item, names) })),
      (item) => item.view.groupKey,
    );
    expect(folded).toHaveLength(1);
    expect(folded[0]!.repeats).toBe(2);
    expect(folded[0]!.since).toBe("2026-10-15T10:00:00Z");
    expect(folded[0]!.item.view.body).toBe(
      "The chain did not accept it (it expired or was refused there), so it was cancelled. Any stake it reserved is free again.",
    );
  });

  it("gives a new report its deadline and what silence costs", () => {
    const view = inboxView(
      row({
        event: "call_dispute.opened",
        severity: "WARNING",
        title: "A buyer disputed a call you served",
        body: 'A buyer reported "Other" on a call you served. You may reply once before an operator decides.',
        subjectType: "call_dispute",
        subjectId: "d1",
        createdAt: "2026-10-18T10:00:00Z",
        payload: { role: "provider", disputeId: "d1", reasonLabel: "Other", replyDueAt: "2026-10-19T10:00:00Z", autoUpholdAt: "2026-10-21T10:00:00Z" },
      }),
      names,
    );
    expect(view.body).toBe(
      'The buyer says: "Other". Reply by tomorrow 10:00 UTC. If you don\'t, the buyer wins: it is upheld automatically at Oct 21, 10:00 UTC.',
    );
    expect(view.body).not.toMatch(/may reply/i);
  });

  it("tells an arbiter win apart from a chain refusal, and never folds them together", () => {
    const decided = (id: string, payload: Record<string, unknown>) =>
      row({ id, event: "provider.slash_decided", title: "x", body: "y", payload: { proposalId: id, reservationHeldUntil: null, ...payload } });
    const arbiter = decided("a", { resolutionKind: "CHAIN_ARBITER", penaltyAmount: "40000", decimals: 6 });
    const chain = decided("b", { resolutionKind: "AUTO_CHAIN_VOIDED", penaltyAmount: "40000", decimals: 6 });
    const arbiterView = inboxView(arbiter, names);
    expect(arbiterView.title).toBe("$0.04 penalty was cancelled: nothing was taken");
    expect(arbiterView.body).toBe("The arbiter ruled for you on chain. Any stake it reserved is free again.");
    const folded = collapseNotices(
      [arbiter, chain].map((item) => ({ ...item, view: inboxView(item, names) })),
      (item) => item.view.groupKey,
    );
    expect(folded).toHaveLength(2);
  });

  it("folds cancellations only within one tool", () => {
    const decided = (id: string, toolName: string) =>
      row({ id, event: "provider.slash_decided", title: "x", body: "y", payload: { proposalId: id, toolName, resolutionKind: "AUTO_CHAIN_VOIDED" } });
    const items = [decided("a", "get_weather"), decided("b", "get_usd_eur_rate"), decided("c", "get_weather")];
    const folded = collapseNotices(
      items.map((item) => ({ ...item, view: inboxView(item, names) })),
      (item) => item.view.groupKey,
    );
    expect(folded.map((entry) => entry.repeats)).toEqual([1, 0]);
  });

  it("renders every other known provider event readably from its payload", () => {
    const cases: NotificationItem[] = [
      row({
        event: "provider.sla_breach_proposed",
        title: "SLA window w_102 closed in breach",
        body: "Observed failure rate 15.00% … Estimated penalty 28470000 solana:EtWT/token:4zMM (uncapped)",
        subjectType: "binding",
        subjectId: "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc",
        payload: { label: "w_504", bindingId: "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc", observedRate: 0.15, effectiveThreshold: 0.03806, verifiedCalls: 400, penaltyAmount: "28470000" },
      }),
      row({
        event: "provider.sla_window_warning",
        title: "SLA window w_1 is projected to breach",
        body: "Top agent: dcff5fef-5f11-4bc6-8d85-d64e38da6e39.",
        payload: { windowId: "w", bindingId: "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc", observedFailureRate: 0.09, declaredFailureRate: 0.02, verifiedCalls: 100, callsRemaining: 300, topFailingRule: "insufficient_results", topAgentId: "dcff5fef-5f11-4bc6-8d85-d64e38da6e39" },
      }),
      row({
        event: "provider.stake_grace_opened",
        title: "Stake below your minimum — grace period started",
        body: "Your stake for one binding is below your 100.000000 minimum.",
        payload: { bindingId: "1fbd249d-d4a5-4f33-aa21-6aa69487b2fc", staked: "80000000", required: "100000000", graceDays: 5, expiresAt: "2026-10-20T10:00:00Z" },
      }),
      row({ event: "provider.stake_grace_expired", title: "x", body: "y", payload: { bindingId: "b9", staked: "80000000", required: "100000000", graceDays: 5 } }),
      row({ event: "provider.stake_grace_cured", title: "x", body: "y", payload: { bindingId: "b9", staked: "120000000", required: "100000000" } }),
      row({ event: "provider.slash_reversed", title: "40000 was returned to your stake", body: "Transaction 0xabc.", payload: { restored: "40000", proposalId: "p" } }),
      row({
        event: "provider.slash_decided",
        title: "A proposed penalty against your stake was upheld",
        body: "The proposal stands at 28470000. Nothing executes before 2026-10-18T19:14:37.507Z.",
        payload: { proposalId: "p", outcome: "UPHELD", overturned: false, penaltyAmount: "28470000" },
      }),
    ];
    const views = cases.map((item) => inboxView(item, names));
    for (const view of views) {
      expectReadable(view.title);
      expectReadable(view.body);
    }
    expect(views[0]!.title).toBe("get_weather: a check window closed over your promise");
    expect(views[0]!.body).toBe("15% of 400 checked calls failed; the limit was 3.8%. A penalty of up to $28.47 is proposed; your stake limits apply when it is filed.");
    expect(views[1]!.title).toBe("get_weather: 9% of calls failed in a check window, over your 2% promise");
    expect(views[2]!.title).toBe("get_weather: your stake is below the $100.00 minimum");
    expect(views[3]!.body).toContain("minimum for 5 days");
    expect(views[4]!.title).toBe("One paid tool: your stake is back above the minimum");
    expect(views[5]!.title).toBe("$0.04 was returned to your stake");
    expect(views[6]!.title).toBe("$28.47 penalty was upheld");
  });

  it("guards stored text when a known event lacks a payload field", () => {
    const view = inboxView(
      row({ event: "provider.slash_executed", title: "40000 was taken from your stake", body: "Case 1c9fb28b-336e-4024-83c7-dec937c49a9d.", payload: {} }),
      names,
    );
    expect(view.title).toBe("$0.04 was taken from your stake");
    expectReadable(view.title);
    expectReadable(view.body);
  });

  it("guards the stored text of events it does not render", () => {
    const view = inboxView(
      row({
        event: "provider.something_new",
        title: "Binding 1fbd249d-d4a5-4f33-aa21-6aa69487b2fc is within 20% of its 100.000000 stake floor",
        body: "Estimated penalty 28470000 solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU before 2026-10-18T19:14:37.507Z, agent dcff5fef-5f11-4bc6-8d85-d64e38da6e39.",
      }),
      names,
    );
    expect(view.title).toBe("One of your tools is within 20% of its $100.00 stake floor");
    expect(view.body).toBe("Estimated penalty $28.47 before today 19:14 UTC, an agent.");
    expectReadable(view.title);
    expectReadable(view.body);
  });

  it("keeps the stored text of events it does not know", () => {
    const view = inboxView(row({ event: "provider.payout_sent", title: "Payout sent", body: "Your payout of $4.00 was sent." }), names);
    expect(view.title).toBe("Payout sent");
    expect(view.body).toBe("Your payout of $4.00 was sent.");
  });
});

describe("notificationHref", () => {
  it("links penalties to their drawer and leaves unknown subjects without a link", () => {
    expect(notificationHref({ subjectType: "slash_proposal", subjectId: "p1" })?.href).toBe("/provider/penalties?case=p1");
    expect(notificationHref({ subjectType: "binding", subjectId: "b1" })?.href).toBe("/provider/bindings/view?binding=b1");
    expect(notificationHref({ subjectType: "agent", subjectId: "a1" })).toBeNull();
    expect(notificationHref({ subjectType: "slash_proposal", subjectId: null })).toBeNull();
  });
});
