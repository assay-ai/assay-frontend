import { describe, expect, it } from "vitest";

import { shownErrors } from "@/components/patterns/reason-chips";
import type { Money } from "@/interfaces/api";
import type { OperatorDirectoryEntry, OperatorRole } from "@/interfaces/operator";
import { OPERATOR_FIXTURES } from "@/libs/demo/fixtures-operator";

import { penaltyPhrase } from "./approvals";
import { noTargetText } from "./block-targets";
import { disputeDayText } from "./inbox";
import { aboutProvider, operatorRowLabel, plainKey } from "./operator-measurement";
import { splitSharesText } from "./penalty-money";
import { filterRecent, knownPenalties, penaltyIdFrom, RECENT_PENALTIES_MAX, withRecent, type KnownPenalty, type RecentPenalty } from "./recent-penalties";
import { roleCanSentence } from "./role-intro";
import { capabilitiesFor, checkAction, ROLE_PRESETS, roleDescription, whoCan } from "./roles";
import { sentForApproval, toTwoPersonAnswer } from "./two-person";
import { askLabel, whoCanSentence } from "./why-not";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const USD = (amount: string): Money => ({ amount, asset: "eip155:46630/erc20:0xabc", decimals: 6 });

function op(id: string, name: string, roles: OperatorRole[], limit: Money | null = USD("1000000000")): OperatorDirectoryEntry {
  return {
    id,
    subject: `${id}@`,
    displayName: name,
    walletAddress: null,
    roles,
    authorityLimit: limit,
    status: "ACTIVE",
    email: `${id}@assay.example`,
    lastSeenAt: null,
    createdAt: iso(NOW - 10 * DAY),
  };
}

describe("two-person results tell the truth (top fix 1)", () => {
  it("reads a queued body as queued even when the status line says 200", () => {
    const body = { approvalId: "apr-9", status: "PENDING", action: "account.unblock", expiresAt: iso(NOW + DAY) };
    expect(toTwoPersonAnswer({ status: 200, data: body })).toEqual({ kind: "queued", approval: body });
    expect(toTwoPersonAnswer({ status: 200, data: { id: "blk-2", active: false } }).kind).toBe("done");
  });

  it("says who it was sent to and when it lapses, never that it is done", () => {
    const sent = sentForApproval("Lifting the block on Wallet 0x9F3c…F36c", ["Riley Brooks"], "a second Lead adjudicator", iso(NOW + DAY), NOW);
    expect(sent.title).toBe("Sent for approval to Riley Brooks · expires in 24 h");
    expect(sent.next).toMatch(/has not happened yet/);
    expect(sentForApproval("X", ["A B", "C D"], "a second Admin", null, NOW).title).toBe("Sent for approval to A B or C D · expires in 24 h");
    expect(sentForApproval("X", [], "a second Admin", null, NOW).title).toBe("Sent for approval to a second Admin · expires in 24 h");
  });
});

describe("capability is explicit (top fix 2)", () => {
  const support = { roles: ["SRE", "SUP"] as OperatorRole[], authorityLimit: USD("0") };
  const lead = { roles: ["ADJL"] as OperatorRole[], authorityLimit: USD("1000000000") };
  const admin = { roles: ["OPS_ADMIN"] as OperatorRole[], authorityLimit: USD("0") };

  it("rules out money actions on a $0 limit, so the banner never promises Suspend to Support", () => {
    expect(checkAction(support, "suspend")).toMatchObject({ allowed: false, limitOnly: true });
    expect(checkAction(support, "suspend").why).toMatch(/authority limit is \$0/);
    expect(capabilitiesFor(support.roles, support.authorityLimit).can).toEqual(["block an account"]);
    expect(roleCanSentence(support)).toBe("You can block an account.");
    // Without a limit given, the role alone decides (older callers).
    expect(capabilitiesFor(support.roles).can).toContain("suspend a penalty");
  });

  it("names the amount when a penalty is above the limit", () => {
    expect(checkAction({ roles: ["ADJ"], authorityLimit: USD("10000000") }, "suspend", USD("28470000")).why).toBe(
      "It is $28.47, above your authority limit of $10.00.",
    );
  });

  it("says which role an action needs", () => {
    expect(checkAction(admin, "block").why).toBe("Block an account needs Lead adjudicator or Support / on-call.");
    expect(checkAction(lead, "rule").allowed).toBe(true);
    expect(roleCanSentence(admin)).toBe("You can also add and change operators.");
  });

  it("finds who can instead, with the same check", () => {
    const team = [op("jordan", "Jordan Blake", ["ADJL"]), op("sam", "Sam Reyes", ["SRE"], USD("0")), op("iris", "Iris Park", ["ADJ"], USD("10000000"))];
    expect(whoCan("suspend", team, { amount: USD("28470000"), exceptId: "sam" })).toEqual(["Jordan Blake"]);
    expect(whoCan("block", team, { exceptId: "jordan" })).toEqual(["Sam Reyes"]);
  });

  it("words the ask button and the who-can line", () => {
    expect(askLabel(["Jordan Blake"], "Lead adjudicator")).toBe("Ask Jordan Blake");
    expect(askLabel(["Jordan Blake", "Riley Brooks"], "x")).toBe("Ask Jordan or Riley");
    expect(askLabel([], "Lead adjudicator or Treasury")).toBe("Ask a Lead adjudicator");
    expect(askLabel([], "Admin")).toBe("Ask an Admin");
    expect(whoCanSentence(["Jordan Blake", "Riley Brooks"], "Lead adjudicator")).toBe("Jordan Blake or Riley Brooks (Lead adjudicator).");
    expect(whoCanSentence([], "Admin")).toMatch(/^Nobody on the team right now/);
    // Read after "Who can:", so the answer never says "can" again.
    expect(whoCanSentence(["Dan Ortiz", "Ava Chen"], "Admin")).not.toMatch(/\bcan\b/);
  });
});

describe("one source of truth for numbers (top fix 3)", () => {
  it("states one split", () => {
    expect(splitSharesText(6000)).toBe("60% to the agents who paid · 30% to the platform · 10% stays with the provider");
  });

  it("says where a dispute stands the same way everywhere", () => {
    expect(disputeDayText({ disputedAt: iso(NOW - 23 * DAY), expiresAt: iso(NOW + 7 * DAY) }, NOW)).toBe("Day 24 of 30 · 7 days left");
    expect(disputeDayText({ disputedAt: null, expiresAt: null }, NOW)).toBe("Expiry unknown");
  });

  it("names a penalty by provider and amount", () => {
    expect(penaltyPhrase("Northwind Geo", "$28.47")).toBe("Northwind Geo's $28.47 penalty");
    expect(penaltyPhrase("Helios Data Labs", "$12.40")).toBe("Helios Data Labs' $12.40 penalty");
  });

  it("never prints a raw field name in the measurement, and speaks about the provider", () => {
    expect(plainKey("declared_rate")).toBe("Declared rate");
    expect(operatorRowLabel("declared_rate")).toBe("Declared rate");
    expect(operatorRowLabel("declared_sla")).toBe("Failure rate the provider declared");
    expect(aboutProvider("× 13% over your declared rate")).toBe("× 13% over the provider's declared rate");
  });
});

describe("forms", () => {
  it("drops a reason or note error as soon as the field is valid", () => {
    const errors = { reason: "Pick a reason.", note: "Write at least 20 characters" };
    expect(shownErrors(errors, "", "short", 20)).toEqual({ reason: "Pick a reason.", note: "Write at least 20 characters" });
    expect(shownErrors(errors, "FRAUD", "a note that is long enough now", 20)).toEqual({ reason: null, note: null });
    expect(shownErrors(errors, "FRAUD", "x".repeat(30), 20, 25).note).toBe("Write at least 20 characters");
  });

  it("says what to type in an empty block search", () => {
    expect(noTargetText("")).toBe("Type a wallet (0x…), a provider's name or an organization id.");
  });
});

describe("recent penalties", () => {
  const row = (id: string, label = `P ${id}`): RecentPenalty => ({ id, providerId: "p", label, at: iso(NOW) });
  it("keeps the newest first, once, capped", () => {
    const list = withRecent([row("a"), row("b")], row("b"));
    expect(list.map((r) => r.id)).toEqual(["b", "a"]);
    let many: RecentPenalty[] = [];
    for (let i = 0; i < 15; i += 1) many = withRecent(many, row(String(i)));
    expect(many).toHaveLength(RECENT_PENALTIES_MAX);
    expect(filterRecent([row("a", "Northwind Geo's $1 penalty"), row("b", "Helios")], "north").map((r) => r.id)).toEqual(["a"]);
  });
});

describe("the demo stage set follows what was done", () => {
  const fixture = (method: string, path: string) => {
    const found = OPERATOR_FIXTURES.find((f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path));
    if (!found) throw new Error(`no fixture for ${method} ${path}`);
    return (query: Record<string, unknown> = {}, data?: Record<string, unknown>) => found.body(path, query, data);
  };
  const NORTHWIND_CASE = "8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18";

  it("answers a lift with a queued request that then waits in the inbox", () => {
    const answer = fixture("POST", "/operator/blocks/blk-1/unblock")({}, { reasonCode: "RESOLVED", note: "Incident closed, verified." }) as {
      approvalId: string;
      status: string;
    };
    expect(answer.status).toBe("PENDING");
    const pending = fixture("GET", "/operator/approvals")({ status: "PENDING" }) as { items: { id: string }[] };
    expect(pending.items.some((a) => a.id === answer.approvalId)).toBe(true);
  });

  it("moves a suspended penalty on, and logs the reason that was picked", () => {
    fixture("POST", `/operator/cases/${NORTHWIND_CASE}/suspend`)({}, { reasonCode: "PROPOSED_IN_ERROR", note: "The window overlapped our outage." });
    const brief = fixture("GET", `/operator/cases/${NORTHWIND_CASE}`)() as { chainStatus: string; case: { proposal: { status: string } } };
    expect(brief.case.proposal.status).toBe("OVERTURNED");
    expect(brief.chainStatus).toBe("CANCEL_REQUESTED");
    const log = fixture("GET", "/operator/override-log")({ targetId: NORTHWIND_CASE }) as { items: { reasonCode: string }[] };
    expect(log.items[0]?.reasonCode).toBe("PROPOSED_IN_ERROR");
  });

  it("takes an approved request off the waiting list and lifts its block", () => {
    fixture("POST", "/operator/approvals/apr-unblock-1/approve")();
    const pending = fixture("GET", "/operator/approvals")({ status: "PENDING" }) as { items: { id: string }[] };
    expect(pending.items.some((a) => a.id === "apr-unblock-1")).toBe(false);
    const blocks = fixture("GET", "/operator/blocks")({ active: "false" }) as { items: { id: string }[] };
    expect(blocks.items.some((b) => b.id === "blk-2")).toBe(true);
  });

  it("uses the provider's declared-rate key the label table knows", () => {
    const brief = fixture("GET", `/operator/cases/${NORTHWIND_CASE}`)() as { case: { arithmetic: { key: string }[] } };
    expect(brief.case.arithmetic.map((row) => row.key)).not.toContain("declared_rate");
  });
});

describe("finding a penalty (round 2, top 2)", () => {
  const names: Record<string, string> = { nw: "Northwind Geo", co: "Cobalt Street Data" };
  const name = (id: string) => names[id] ?? id;
  const row = (id: string, providerId: string, source: KnownPenalty["source"]): KnownPenalty => ({ id, providerId, label: `${name(providerId)}'s penalty`, source });

  it("searches every list that exists by provider, one row per penalty, first source wins", () => {
    const sources = {
      disputed: [row("a", "nw", "disputed")],
      activity: [row("a", "nw", "activity"), row("b", "co", "activity")],
      recent: [row("c", "nw", "recent")],
    };
    expect(knownPenalties(sources, name, "north").map((r) => [r.id, r.source])).toEqual([
      ["a", "disputed"],
      ["c", "recent"],
    ]);
    expect(knownPenalties(sources, name, "").map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(knownPenalties(sources, name, "nobody")).toEqual([]);
  });

  it("reads a penalty id out of a bare id or any link", () => {
    expect(penaltyIdFrom(" 8B3F2E9A-1c74-4d05-b6e2-7f0a9c3d5e18 ")).toBe("8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18");
    expect(penaltyIdFrom("https://app.example/operator/cases/view?id=8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18")).toBe("8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18");
    expect(penaltyIdFrom("Northwind")).toBeNull();
  });
});

describe("roles described by what they can do (round 2, top 3)", () => {
  it("never says Support suspends penalties outright: money actions carry the limit", () => {
    const support = ROLE_PRESETS.find((p) => p.id === "support")!;
    expect(support.description).toBe(roleDescription(["SRE", "SUP"]));
    expect(support.description).toMatch(/suspends penalties up to its limit \(none at \$0\)/i);
    expect(support.description).not.toMatch(/suspends penalties[,.]/i);
    expect(roleDescription(["OPS_ADMIN"])).toMatch(/^Adds, changes and removes operators\. Approves/);
    expect(support.description).toBe("Blocks accounts. Suspends penalties up to its limit (none at $0).");
  });

  it("lists who can suspend only among those whose limit covers the penalty, and says so", () => {
    const team = [
      { id: "a", roles: ["ADJ"] as OperatorRole[], status: "ACTIVE" as const, displayName: "Iris Park", subject: "iris@", authorityLimit: USD("250000000") },
      { id: "b", roles: ["ADJL"] as OperatorRole[], status: "ACTIVE" as const, displayName: "Jordan Blake", subject: "jordan@", authorityLimit: USD("1000000000") },
      { id: "c", roles: ["SRE", "SUP"] as OperatorRole[], status: "ACTIVE" as const, displayName: "Sam Reyes", subject: "sam@", authorityLimit: USD("0") },
    ];
    expect(whoCan("suspend", team, { amount: USD("28470000") })).toEqual(["Iris Park", "Jordan Blake"]);
    expect(whoCan("suspend", team, { amount: USD("300000000") })).toEqual(["Jordan Blake"]);
    expect(whoCanSentence(["Jordan Blake"], "Lead adjudicator", "$300.00")).toBe(
      "Jordan Blake (Lead adjudicator, with an authority limit of at least $300.00).",
    );
  });
});
