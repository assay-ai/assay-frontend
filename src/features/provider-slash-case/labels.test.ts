import { describe, expect, it } from "vitest";

import type { SlashArithmeticRow } from "@/interfaces/provider-slash-cases";

import {
  arithmeticLabel,
  eventLabel,
  eventSummary,
  presentArithmeticRow,
  restorationValue,
} from "./labels";

const money = { asset: "x", decimals: 6 };
const context = {
  ...money,
  toolName: "Weather forecast",
  bindingId: "39421075-5823-4b1e-9f0e-000000000000",
};

const row = (
  key: string,
  value: string,
  expression: string | null = null,
  note: string | null = null,
): SlashArithmeticRow => ({ key, value, expression, note, tone: "NEUTRAL" });

describe("presentArithmeticRow", () => {
  it("names every field the server sends in words", () => {
    for (const key of [
      "window_calls",
      "verified_calls",
      "excluded_calls",
      "failed_verified_calls",
      "observed_rate",
      "declared_sla",
      "tolerance",
      "effective_threshold",
      "penalty",
      "per_window_cap",
    ]) {
      expect(arithmeticLabel(key)).not.toMatch(/_/);
    }
    expect(arithmeticLabel("something_new")).toBe("something_new");
  });

  it("writes the penalty calculation in money and words", () => {
    const out = presentArithmeticRow(
      row(
        "penalty",
        "28.470000",
        "109500000 × 13.0000% × 2 (= estimated_bad × average_price × multiplier)",
      ),
      money,
    );
    expect(out.label).toBe("Proposed penalty");
    expect(out.value).toBe("$28.47");
    expect(out.expression).toBe(
      "$109.50 total price of this window's calls × 13.0000% over your declared rate × 2 (penalty multiplier)",
    );
  });

  it("never shows a sub-cent penalty as $0.00, and leaves an unknown value alone", () => {
    expect(presentArithmeticRow(row("penalty", "0.000400"), money).value).toBe("$0.0004");
    expect(presentArithmeticRow(row("penalty", "n/a", "something else"), money)).toMatchObject({
      value: "n/a",
      expression: "something else",
    });
  });

  it("replaces the cap's internal sentence with a user one", () => {
    const out = presentArithmeticRow(
      row("per_window_cap", "enforced on chain — not computed here"),
      money,
    );
    expect(out.value).toBe("—");
    expect(out.note).toMatch(/never pays less.*paid in full\.$/);
  });

  it("puts the excluded agent's id behind words", () => {
    const out = presentArithmeticRow(
      row("excluded_calls", "12", null, "excluded agent: 38b4b3f6-aaaa-bbbb-cccc-000000000000"),
      money,
    );
    expect(out.note).toBe("all from one agent · id 38b4b3f6-aaaa-bbbb-cccc-000000000000");
  });
});

describe("eventLabel", () => {
  it("names the codes and falls back to sentence case", () => {
    expect(eventLabel("PROPOSED")).toBe("Penalty proposed");
    expect(eventLabel("NOTIFIED")).toBe("Notice delivered");
    expect(eventLabel("DISPUTE_FILED")).toBe("Dispute filed");
    expect(eventLabel("SOMETHING_NEW")).toBe("Something new");
  });

  it("R2-6: names the superseded-record and re-adopted entries", () => {
    expect(eventLabel("CHAIN_SUPERSEDED_RECORD")).toBe(
      "Earlier record landed late — the arbiter is asked to cancel it",
    );
    expect(eventLabel("CHAIN_PART_READOPTED")).toBe("Late record adopted");
  });
});

describe("eventSummary", () => {
  it("writes the proposal as money against the tool's name", () => {
    expect(eventSummary(`Slash proposed: 28470000 against ${context.bindingId}`, context)).toBe(
      "Penalty of $28.47 proposed against Weather forecast",
    );
  });

  it("formats the other amounts and timestamps", () => {
    expect(eventSummary("Penalty of 28470000 taken from stake", context)).toBe(
      "Penalty of $28.47 taken from stake",
    );
    expect(
      eventSummary(
        "28470000 of stake is reserved on chain; nothing can execute before 2026-10-21T17:38:00.000Z",
        context,
      ),
    ).toBe("$28.47 of stake is reserved on chain; nothing can execute before 2026-10-21 17:38 UTC");
    expect(
      eventSummary("Delivered; the provider has until 2026-10-15T17:38:00.000Z to object", context),
    ).toBe("Delivered. You have until 2026-10-15 17:38 UTC to dispute");
  });

  it("names the claim and leaves an unknown sentence as it is", () => {
    expect(eventSummary("Objection filed: INSUFFICIENT_SAMPLE", context)).toBe(
      "Dispute filed: The sample is too small to support this conclusion",
    );
    expect(eventSummary("Something we do not know", context)).toBe("Something we do not know");
  });
});

describe("restorationValue", () => {
  it("writes a bare amount as money and keeps words as they are", () => {
    expect(restorationValue("28.470000", money)).toBe("$28.47");
    expect(restorationValue("not tracked — no producer exists for this yet", money)).toBe(
      "not tracked yet",
    );
    expect(restorationValue("1 strike", money)).toBe("1 strike");
  });
});
