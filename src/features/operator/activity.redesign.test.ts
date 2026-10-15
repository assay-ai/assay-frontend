import { describe, expect, it } from "vitest";

import type { OverrideLogEntry } from "@/interfaces/operator";

import { activityIcon, activitySentence, activityText, byActor, groupByDay, rulingOf } from "./activity";

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
    expect(["A-9", "A-10", "A-11", "S-1", "S-13", "S-5", "A-12", "X"].map((code) => activityIcon({ code }))).toEqual([
      "block",
      "unblock",
      "chain",
      "suspend",
      "ruling",
      "money",
      "team",
      "other",
    ]);
  });
});
