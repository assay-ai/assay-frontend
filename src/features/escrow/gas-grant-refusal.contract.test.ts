import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GasGrantRefusal, WithdrawGasGrant } from "@/interfaces";
import SNAPSHOT from "@/interfaces/gas-grant-refusal.backend.json";

import { resetUnknownRefusalReports, withdrawGasGrantNote } from "./withdraw-gas-grant-note";

/*
  The gate `withdraw-gas-grant-note.test.ts` cannot be.

  That file enumerates the refusals by hand and asserts each has a distinct
  sentence — a real assertion about the COPY, and no assertion at all about the
  vocabulary, because the hand list and the union it is typed against are the
  two things that go stale together. A backend that adds a reason leaves both
  untouched and that suite stays green; it did, and `GRANT_IN_FLIGHT` reached a
  buyer as the outage sentence.

  So everything here is compared against `gas-grant-refusal.backend.json`, which
  is not written by hand: `scripts/check-gas-grant-refusals.js` parses the
  backend's own `GasGrantRefusal` enum and writes it. This file is the half of
  that check that runs in `pnpm test` on a machine with no backend checkout.

  **What this does NOT prove.** The snapshot is only as fresh as the last run of
  that script — it is one indirection away from the backend, not a live read. A
  reason added to the backend this morning is invisible here until somebody runs
  `pnpm check:refusals`. That is stated plainly rather than papered over: the
  runtime is what covers the remaining gap, and `withdrawGasGrantNote` logs an
  unknown reason rather than silently degrading (asserted below).
*/

const REASONS: readonly string[] = SNAPSHOT.reasons;

const refused = (reason: string): WithdrawGasGrant => ({
  status: "REFUSED",
  reason: reason as GasGrantRefusal,
  transactionHash: null,
});

/** The union in `interfaces/escrow.ts`, read as text — a type has no runtime form. */
function unionMembers(): string[] {
  const source = readFileSync(resolve(__dirname, "../../interfaces/escrow.ts"), "utf8");
  const block = source.match(/export type GasGrantRefusal =([\s\S]*?);/);
  if (!block) throw new Error("could not find `export type GasGrantRefusal = …;`");
  return (block[1].match(/"([A-Z][A-Z0-9_]*)"/g) ?? []).map((s) => s.slice(1, -1));
}

describe("GasGrantRefusal against the backend enum", () => {
  it("has a snapshot that names where it came from and is not empty", () => {
    // A snapshot that silently emptied would make every assertion below vacuous
    // — `[].every(…)` is true, and a green run over zero reasons is the exact
    // shape of gate this codebase keeps getting caught by.
    expect(SNAPSHOT.enum).toBe("GasGrantRefusal");
    expect(SNAPSHOT.source).toMatch(/withdraw-gas-grant\.port\.ts$/);
    expect(REASONS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(REASONS).size).toBe(REASONS.length);
  });

  it("declares exactly the backend's members in the union, and no others", () => {
    // Both directions. A member here that the backend does not have is copy for
    // a case that can never arrive; a member the backend has and this does not
    // is a buyer told the wrong thing.
    expect([...unionMembers()].sort()).toEqual([...REASONS].sort());
  });

  it("has its own sentence for every backend reason — none falls through to the outage copy", () => {
    const outage = withdrawGasGrantNote({
      status: "UNAVAILABLE",
      reason: null,
      transactionHash: null,
    })?.text;
    expect(outage).toBeTruthy();

    const texts = REASONS.map((reason) => withdrawGasGrantNote(refused(reason))?.text);

    for (const [i, text] of texts.entries()) {
      expect(text, `${REASONS[i]} produced no note`).toBeTruthy();
      // The precise defect this closes: a reason with no entry returned the
      // OUTAGE sentence, which tells a buyer the faucet could not be consulted
      // when in fact a control fired and said exactly why.
      expect(text, `${REASONS[i]} fell through to the outage sentence`).not.toBe(outage);
    }
    // Distinct, not merely present: one sentence reused across two reasons is a
    // default arm wearing eight keys.
    expect(new Set(texts).size).toBe(REASONS.length);
  });

  it("tells a contending buyer to come back, and never that their one chance is spent", () => {
    /*
      `GRANT_IN_FLIGHT` is the reason this whole file exists, and the backend's
      own enum comment is explicit about what it must not be confused with:
      "Not ALREADY_GRANTED, and the difference is the whole point: nothing has
      been granted, the once-ever budget is intact, and the correct thing for
      the caller to do is ask again in a moment."
    */
    expect(REASONS).toContain("GRANT_IN_FLIGHT");

    const note = withdrawGasGrantNote(refused("GRANT_IN_FLIGHT"));
    const spent = withdrawGasGrantNote(refused("ALREADY_GRANTED"));

    expect(note?.tone).toBe("wait");
    expect(note?.text).not.toBe(spent?.text);
    // "one-time", "already been covered", "you will need your own" — every way
    // of saying the budget is gone is wrong here, and it is the failure that
    // costs a buyer money they did not have to spend.
    expect(note?.text).not.toMatch(/one[- ]time|already been (covered|funded)|will need enough/i);
    // And it has to say the thing that makes the buyer come back.
    expect(note?.text).toMatch(/moment|again|reload/i);
  });
});

describe("a reason this build has never heard of", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetUnknownRefusalReports();
  });

  it("is LOUD, and is still shown as the outage rather than as `undefined`", () => {
    /*
      The state the mirror was actually in for the whole of `GRANT_IN_FLIGHT`'s
      life on the backend: a real refusal arrives, this build has no sentence,
      and the buyer is told the faucet could not be consulted. The copy stays —
      it is the only sentence still true when the build does not know what the
      backend said — but the silence does not. A developer with the console open
      now sees the reason by name.
    */
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const note = withdrawGasGrantNote(refused("REASON_FROM_THE_FUTURE"));

    expect(note?.text).toMatch(/could not check/i);
    expect(note?.text).not.toMatch(/undefined/);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("REASON_FROM_THE_FUTURE");
  });

  it("says nothing at all for a reason that IS known", () => {
    // Otherwise the previous assertion is satisfied by a module that shouts on
    // every render, which is a log nobody reads and therefore no signal.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const reason of REASONS) withdrawGasGrantNote(refused(reason));
    withdrawGasGrantNote({ status: "REFUSED", reason: null, transactionHash: null });

    expect(spy).not.toHaveBeenCalled();
  });

  it("reports each unknown reason once, not once per render", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 5; i += 1) withdrawGasGrantNote(refused("REASON_FROM_THE_FUTURE"));
    withdrawGasGrantNote(refused("A_SECOND_UNKNOWN_REASON"));

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
