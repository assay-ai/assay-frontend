import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { chainUnavailableSentence, listLoadError, nothingStandingOutcome, operatorErrorSentence } from "./operator-errors";

const conflict = (context: Record<string, unknown>) => new ApiError("SLASH_NOTHING_STANDING", "Nothing of this case stands on chain", 409, "/x", context);

describe("409 SLASH_NOTHING_STANDING reads its context", () => {
  it("C1: EXECUTED is an alert that the stake was taken, never 'nothing'", () => {
    const outcome = nothingStandingOutcome(conflict({ chainStatus: "EXECUTED" }));
    expect(outcome).toMatchObject({ title: "Executed on chain while the cancel waited", alert: true });
    expect(outcome.next).toContain("The stake was taken");
    expect(outcome.next).not.toMatch(/closed its side|nothing to sign/);
    expect(operatorErrorSentence(conflict({ chainStatus: "EXECUTED" }))).toContain("The stake was taken");
  });

  it("never says anything was closed or changed on chain", () => {
    for (const chainStatus of ["CANCELLED", "NOT_FOUND", "PROPOSING", "EXECUTED"]) {
      expect(nothingStandingOutcome(conflict({ chainStatus })).next).not.toMatch(/closed its side/);
    }
    expect(nothingStandingOutcome(conflict({ chainStatus: "CANCELLED" })).next).toContain("Nothing was changed");
  });

  it("a record not found is said plainly, nothing changed", () => {
    expect(nothingStandingOutcome(conflict({ chainStatus: "NOT_FOUND" }))).toMatchObject({ alert: false, title: "No record of this penalty is found on chain" });
  });
});

describe("SLASH_CHAIN_UNAVAILABLE", () => {
  it("reads the reason from the context first", () => {
    const error = new ApiError("SLASH_CHAIN_UNAVAILABLE", "whatever", 503, "/x", { reason: "its on-chain record could not be read (transport)" });
    expect(chainUnavailableSentence(error)).toBe("The transaction could not be built: its on-chain record could not be read (transport).");
    expect(operatorErrorSentence(error)).toBe(chainUnavailableSentence(error));
  });

  it("falls back to the message", () => {
    const error = new ApiError("SLASH_CHAIN_UNAVAILABLE", "No transaction could be built for this case: no settlement executor. Nothing was signed or submitted", 503);
    expect(chainUnavailableSentence(error)).toBe("The transaction could not be built: no settlement executor.");
  });
});

describe("listLoadError", () => {
  it("a VALIDATION_FAILED list is our bug, to report, with the request and time", () => {
    const error = new ApiError("VALIDATION_FAILED", "order must be…", 400, "/api/v1/operator/call-disputes");
    expect(listLoadError(error, "The disputes", new Date("2026-10-18T14:02:00Z"))).toBe(
      "The disputes could not be loaded. This is a bug on our side; please report it (request /api/v1/operator/call-disputes at 14:02 UTC).",
    );
    expect(listLoadError(new Error("x"), "The disputes")).toBe("The disputes could not be loaded.");
  });
});
