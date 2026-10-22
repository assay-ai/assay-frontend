import { describe, expect, it } from "vitest";

import type { OverrideLogEntry } from "@/interfaces/operator";

import { ACTIVITY_KINDS, activityHref, activityIcon, activitySentence, activityText, byActor, groupByDay, isOfKind, rulingOf } from "./activity";

const entry = (overrides: Partial<OverrideLogEntry>): OverrideLogEntry => ({
  id: "l1",
  createdAt: "2026-10-16T08:00:00.000Z",
  family: "SLASH",
  code: "S-13",
  label: "Arbiter ruling",
  action: "arbiter.ruling",
  actorSubject: "riley@",
  approverSubject: null,
  approvalMode: "SINGLE",
  targetType: "slash_proposal",
  targetId: "p1",
  organizationId: null,
  reasonCode: "EVIDENCE_HOLDS",
  reason: "",
  before: {},
  after: {},
  ticketRef: null,
  breakGlass: false,
  ...overrides,
});
const names = { operator: (s: string | null | undefined) => (s === "riley@" ? "Riley Brooks" : (s ?? "")), target: () => "Lattice Retrieval's $41.20 penalty" };

describe("arbiter rulings in Activity", () => {
  /* Operator review 2026-10-16b, P0-3: S-13 is logged when the call is built, not when it lands. */
  it("says which ruling was prepared, never that it was upheld or cancelled on chain", () => {
    expect(activityText(activitySentence(entry({}), names))).toBe(
      "Riley Brooks prepared an uphold of Lattice Retrieval's $41.20 penalty (Evidence holds): file for the arbiter's signature; takes effect only once it lands (see the penalty for its state).",
    );
    expect(activitySentence(entry({ reasonCode: "PLATFORM_DEFECT" }), names).verb).toBe("prepared a cancel of");
    expect(rulingOf(entry({ reasonCode: "OTHER", after: { ruling: "CANCEL" } }))).toBe("CANCEL");
    expect(rulingOf(entry({ reasonCode: "OTHER", after: { functionName: "upholdSlashBatch" } }))).toBe("UPHOLD");
  });

  it("falls back to 'prepared a ruling on' only when nothing says which way", () => {
    expect(activitySentence(entry({ reasonCode: "OTHER" }), names).verb).toBe("prepared a ruling on");
    expect(rulingOf(entry({ code: "A-9" }))).toBeNull();
  });

  it("never says an on-chain block happened when only its call was built", () => {
    const block = entry({ code: "A-11", action: "arbiter.block", targetType: "chain_blocklist", reasonCode: "FRAUD", approverSubject: "jordan@" });
    const sentence = activitySentence(block, { ...names, target: () => "Wallet 0x9f3C…F36c" });
    expect(sentence.verb).toBe("prepared the on-chain block of");
    expect(sentence.pending).toMatch(/blocked on chain only once it lands/);
    expect(activitySentence(entry({ code: "A-9", reasonCode: "FRAUD" }), names).pending).toBeNull();
  });

  it("names a ruling batch by its penalties, not its type", () => {
    const batch = entry({ targetType: "slash_record_batch", after: { ruling: "UPHOLD", requestIds: ["0x1", "0x2"] } });
    expect(activitySentence(batch, { ...names, target: () => null }).target).toBe("2 disputed penalties");
  });
});

describe("Activity layout helpers", () => {
  it("groups consecutive rows by day, newest first as given", () => {
    const rows = [
      entry({ id: "a", createdAt: "2026-10-16T09:00:00.000Z" }),
      entry({ id: "b", createdAt: "2026-10-16T01:00:00.000Z" }),
      entry({ id: "c", createdAt: "2026-10-14T08:00:00.000Z" }),
    ];
    const groups = groupByDay(rows, (iso) => ({ key: iso.slice(0, 10), label: iso.slice(5, 10) }));
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ["2026-10-16", ["a", "b"]],
      ["2026-10-14", ["c"]],
    ]);
  });

  it("keeps only the actor's own rows for 'By me'", () => {
    const rows = [entry({ id: "a" }), entry({ id: "b", actorSubject: "jordan@", approverSubject: "riley@" })];
    expect(byActor(rows, "riley@").map((r) => r.id)).toEqual(["a"]);
  });

  it("gives every kind an icon", () => {
    expect(["A-9", "A-10", "A-11", "S-13", "S-5", "A-12", "X"].map((code) => activityIcon({ code }))).toEqual([
      "block",
      "unblock",
      "chain",
      "ruling",
      "money",
      "team",
      "other",
    ]);
  });
});

describe("every Activity row is a past-tense sentence (B12)", () => {
  // Every implemented register code (backend override-register.ts).
  const CODES = ["S-2", "S-5", "S-13", "S-14", "S-15", "S-16", "S-17", "V-3", "V-5", "V-7", "P-10", "P-11", "P-12", "A-2", "A-9", "A-10", "A-11", "A-12", "A-13", "A-14", "A-15", "A-16", "A-17", "A-18", "A-19", "A-20", "A-21", "A-22", "A-23", "A-24", "A-25"];

  it("never prints a register label or an imperative", () => {
    for (const code of CODES) {
      const verb = activitySentence(entry({ code, label: "Countersign or object to another adjudicator’s decision", reasonCode: "OTHER" }), names).verb;
      expect(verb, code).not.toMatch(/countersign or object|^decide |^take |^lift |^add |^remove /i);
      expect(verb.split(" ")[0], code).toMatch(/ed$|^took$|^made$|^acted$|^turned$/);
    }
  });

  it("words a catalogue review by its decision", () => {
    const review = (decision: string) => activitySentence(entry({ code: "A-24", targetType: "tool", after: { decision } }), names).verb;
    expect(review("APPROVED")).toBe("approved for the catalogue");
    expect(review("REJECTED")).toBe("turned down for the catalogue");
  });

  it("has Tools and Contracts chips; Tools holds takedowns, reviews and tool versions", () => {
    expect(ACTIVITY_KINDS.map((k) => k.label)).toEqual(expect.arrayContaining(["Tools", "Contracts"]));
    expect(isOfKind(entry({ code: "A-25", targetType: "tool" }), "tools")).toBe(true);
    expect(isOfKind(entry({ code: "A-18", targetType: "moderation_cutoff" }), "tools")).toBe(true);
    expect(isOfKind(entry({ code: "P-10", targetType: "tool" }), "tools")).toBe(true);
    expect(isOfKind(entry({ code: "A-9", targetType: "account_block" }), "tools")).toBe(false);
    // Contract settings change on chain, by the admin key: never in the register.
    expect(isOfKind(entry({ code: "P-10", targetType: "tool" }), "contracts")).toBe(false);
  });

  it("links each row to its record", () => {
    expect(activityHref({ targetType: "account_block", targetId: "blk-1" }, { active: false })).toBe("/operator/blocks?q=blk-1&show=lifted");
    expect(activityHref({ targetType: "account_block", targetId: "blk-1" }, { active: true })).toBe("/operator/blocks?q=blk-1");
    expect(activityHref({ targetType: "operator", targetId: "op-1" })).toBe("/operator/operators#operator-op-1");
    expect(activityHref({ targetType: "tool", targetId: "t1" })).toBe("/operator/tools/view?id=t1");
    expect(activityHref({ targetType: "call_dispute", targetId: "d1" })).toBe("/operator/disputes/view?id=d1");
  });
});

describe("takedown confirm and revert lines (BUG-OPS-MARKET-04)", () => {
  const none = { ...names, target: () => null };
  const cutoff = (code: string, after: Record<string, unknown>) =>
    entry({ code, targetType: "moderation_cutoff", targetId: "c1", after });

  it("names the tool from after.name and says takedown, not cutoff", () => {
    const revert = activitySentence(cutoff("A-19", { reverted: true, name: "e2eprv__e2e_prv_setup_probe", cutoffTargetType: "TOOL" }), none);
    expect(revert.verb).toBe("reverted the takedown of");
    expect(revert.target).toBe("e2eprv__e2e_prv_setup_probe");
    const confirm = activitySentence(cutoff("A-18", { confirmed: true, name: "Weather set", cutoffTargetType: "TOOLSET" }), none);
    expect(confirm.verb).toBe("confirmed the takedown of");
    expect(confirm.target).toBe("Weather set");
  });

  it("writes a public name with its @", () => {
    expect(activitySentence(cutoff("A-19", { name: "acme", cutoffTargetType: "HANDLE" }), none).target).toBe("@acme");
  });

  it("falls back to the kind of thing on an older entry with no name", () => {
    expect(activitySentence(cutoff("A-19", { reverted: true }), none).target).toBe("a tool");
    expect(activitySentence(cutoff("A-18", { cutoffTargetType: "TOOLSET", name: null }), none).target).toBe("a tool set");
  });
});
