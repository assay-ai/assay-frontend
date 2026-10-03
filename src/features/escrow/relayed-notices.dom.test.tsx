import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RelayedDoneNotice, RelayedRefusalNotice } from "./relayed-notices";
import { relayedRefusal } from "./relayed-refusal";

import type { RelayedEscrowIntent } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

/*
  Rendered markup, not props.

  The measured failure on this codebase is a page that kept compiling, kept its
  tests green and kept building 56/56 while a row vanished from what a person
  could actually read — `rows.length === 0` became `!rows`, and an array is
  always truthy. Passing a refusal object into a component proves nothing about
  whether its sentence reaches the screen; this file renders the component and
  reads the TEXT out of the result.

  `renderToStaticMarkup` in a node environment is the same tool
  `wallet-menu-rows.dom.test.tsx` uses, for the same reason: there is no jsdom
  in this project and the question here is what the markup says, not how it
  behaves under a click.
*/

/** The visible text of a render, with every tag and attribute removed. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

const RELAYED: RelayedEscrowIntent = {
  kind: "SET_LIMITS",
  account: "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1",
  transactionHash: "0x7c1de1e2bd2f77bb2e2eb9f6c85ee1a0a8a0a3a6b1c9f2e3d4a5b6c7d8e9f001",
  blockNumber: "101901",
  gasUsed: "48219",
  escrow: {} as RelayedEscrowIntent["escrow"],
};

function refused(reason: string): ApiError {
  return new ApiError(
    "SETTLEMENT_RELAYED_INTENT_REFUSED",
    `The relayed escrow request was refused: ${reason} — nothing was submitted`,
    409,
  );
}

describe("RelayedDoneNotice", () => {
  const text = textOf(
    renderToStaticMarkup(
      <RelayedDoneNotice
        testId="done"
        relayed={RELAYED}
        title="Done — your new limits are on chain."
        effect="Your balance was not touched."
      />,
    ),
  );

  it("puts the block, the gas the platform paid, and the hash on the page", () => {
    expect(text).toContain("Done — your new limits are on chain.");
    expect(text).toContain("already in block 101901");
    expect(text).toContain("48219 gas");
    expect(text).toContain(RELAYED.transactionHash);
  });

  it("says the buyer paid nothing — the zero-ETH buyer is who this door is for", () => {
    expect(text).toContain("you paid none");
  });

  it("carries the screen's own statement of what changed on chain", () => {
    expect(text).toContain("Your balance was not touched.");
  });

  it("never asks the buyer to wait for a confirmation that already happened", () => {
    /*
      The response is about a MINED transaction. "Waiting for the network"
      copy here would be describing something that finished before the answer
      came back, and a buyer would sit watching a screen for nothing.
    */
    expect(text).not.toMatch(/confirm|pending|waiting for the network/i);
  });
});

describe("RelayedRefusalNotice", () => {
  /** Every refusal a submit route can hand back, rendered. */
  const CASES = [
    new ApiError("SETTLEMENT_RELAYED_INTENT_FOR_ANOTHER_BUYER", "names another buyer", 403),
    new ApiError("SETTLEMENT_RELAYED_INTENT_MALFORMED", "signature must be 65 bytes", 400),
    new ApiError("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED", "11 in the last 3600 seconds", 429),
    new ApiError("SETTLEMENT_RELAYED_INTENT_UNAVAILABLE", "budget could not be counted", 503),
    new ApiError("SETTLEMENT_WITHDRAWALS_FROZEN", "frozen", 409),
    refused("BadNonce"),
    refused("SignatureExpired"),
    refused("MalleableSignature"),
    refused("SignerIsNotBuyer"),
    refused("EscrowLimitsUnchanged"),
    refused("ProgramPaused"),
  ];

  function render(error: ApiError, onRebuild?: () => void): string {
    return renderToStaticMarkup(
      <RelayedRefusalNotice
        testId="refusal"
        refusal={relayedRefusal(error)}
        title="Your limits were not changed"
        onRebuild={onRebuild}
      />,
    );
  }

  it("renders a DIFFERENT sentence on the page for every one of them", () => {
    /*
      The assertion that kills "every failure gets the same message". It reads
      the rendered text, so a handler that computed eleven distinct sentences
      and then rendered a twelfth generic one would still fail here.
    */
    const rendered = CASES.map((error) => textOf(render(error)));
    expect(new Set(rendered).size).toBe(CASES.length);
  });

  it("puts the code, and the chain's own name when there is one, on the page", () => {
    expect(textOf(render(refused("BadNonce")))).toContain(
      "SETTLEMENT_RELAYED_INTENT_REFUSED · BadNonce",
    );
    /* No chain refusal, so no separator and no invented name. */
    const rateLimited = textOf(
      render(new ApiError("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED", "too many", 429)),
    );
    expect(rateLimited).toContain("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED");
    expect(rateLimited).not.toContain("·");
  });

  it("offers a fresh request where the signature is dead, and nowhere else", () => {
    const rebuild = () => {};
    /* Dead signature: a spent counter cannot be re-sent, so a new one is the only route. */
    expect(textOf(render(refused("BadNonce"), rebuild))).toContain("Build a fresh request");
    expect(textOf(render(refused("SignatureExpired"), rebuild))).toContain("Build a fresh request");

    /*
      Alive signature: the SAME request goes through once the limiter's window
      passes. A "build a fresh request" button here would spend a counter for
      nothing and retire a perfectly good signature.
    */
    expect(
      textOf(render(new ApiError("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED", "too many", 429), rebuild)),
    ).not.toContain("Build a fresh request");
    expect(textOf(render(refused("ProgramPaused"), rebuild))).not.toContain("Build a fresh request");
    expect(textOf(render(refused("EscrowLimitsUnchanged"), rebuild))).not.toContain(
      "Build a fresh request",
    );
  });

  it("shows no button at all on a screen that passes no rebuild handler", () => {
    /* Present-and-inert is worse than absent: it invites a click that does nothing. */
    expect(textOf(render(refused("BadNonce")))).not.toContain("Build a fresh request");
  });

  it("tells a buyer whose wallet is wrong to change the wallet, not the amount", () => {
    const text = textOf(
      render(new ApiError("SETTLEMENT_RELAYED_INTENT_FOR_ANOTHER_BUYER", "another buyer", 403)),
    );
    expect(text).toMatch(/connect the wallet/i);
    expect(text).toContain("Nothing was submitted");
  });

  it("names the refusal as an alert so it is not read as decoration", () => {
    expect(render(refused("BadNonce"))).toContain('role="alert"');
  });
});
