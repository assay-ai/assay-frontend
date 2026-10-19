import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const ARBITER = "0x2222222222222222222222222222222222222222";

vi.mock("@/hooks/useSigner", () => ({
  useSigner: () => ({ status: "ready", signer: { address: "0x2222222222222222222222222222222222222222" } }),
  useConnectedAddresses: () => ["0x2222222222222222222222222222222222222222"],
  isUserRejection: () => false,
}));

import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { encodeCall } from "@/libs/chains/evm/calldata-fixtures";

import { ContractCallAction } from "./contract-call-action";

const ID = `0x${"1".repeat(64)}` as const;

const call = (functionName: "upholdSlashBatch" | "cancelSlashBatch"): SlashContractCall => ({
  chainId: "eip155:46630",
  to: "0x7242F853db478A28Ae76Ace808212d4B68aa73e7",
  data: encodeCall(`${functionName}(bytes32[])`, [[ID]]),
  value: "0",
  signer: ARBITER,
  signerRole: "ARBITER",
  // The server's label, which says "cancel" whatever the calldata does.
  functionName: "cancelSlashBatch",
  requestIds: [ID],
});

const CANCEL = { contract: "stake" as const, functionName: "cancelSlashBatch", args: [[ID]] };

const markup = (c: SlashContractCall) =>
  renderToStaticMarkup(
    <ContractCallAction call={c} expected={CANCEL} signLabel="Sign and send the ruling" afterExport="." />,
  );

/* Operator review 2026-10-15, F1: the action shows and signs the calldata, not the server's labels. */
describe("ContractCallAction", () => {
  it("shows the function and arguments decoded from the calldata, and offers signing", () => {
    const html = markup(call("cancelSlashBatch"));
    expect(html).toContain("Function (decoded from the calldata)");
    expect(html).toContain(`[${ID}]`);
    expect(html).toContain("Stake contract");
    expect(html).toContain("Sign and send the ruling");
  });

  it("says what is signed in plain words next to the button: action, contract, chain by name, signer", () => {
    const html = markup(call("cancelSlashBatch"));
    expect(html).toContain("What you sign");
    expect(html).toContain("Cancel 1 penalty on chain: 0x1111…1111");
    expect(html).toContain("Stake contract 0x7242…73e7");
    expect(html).toContain("Robinhood Chain testnet");
    expect(html).toContain("Arbiter key 0x2222…2222");
  });

  it("offers neither signing nor the file when the calldata is an uphold labelled as a cancel", () => {
    const html = markup(call("upholdSlashBatch"));
    expect(html).toContain("is not the one you asked for");
    expect(html).toContain("Nothing was signed");
    expect(html).toContain("upholdSlashBatch, not cancelSlashBatch");
    expect(html).not.toContain("Sign and send");
    expect(html).not.toContain("Download");
  });
});
