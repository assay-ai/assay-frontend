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
  to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c",
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

  it("offers neither signing nor the file when the calldata is an uphold labelled as a cancel", () => {
    const html = markup(call("upholdSlashBatch"));
    expect(html).toContain("This is not the transaction you asked for");
    expect(html).toContain("upholdSlashBatch, not cancelSlashBatch");
    expect(html).not.toContain("Sign and send");
    expect(html).not.toContain("Download");
  });
});
