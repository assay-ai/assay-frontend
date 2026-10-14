import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it, vi } from "vitest";

const ARBITER = "0x2222222222222222222222222222222222222222";

vi.mock("@/hooks/useSigner", () => ({
  useSigner: () => ({ status: "ready", signer: { address: "0x2222222222222222222222222222222222222222" } }),
  useConnectedAddresses: () => ["0x2222222222222222222222222222222222222222"],
  isUserRejection: () => false,
}));

import type { SlashContractCall } from "@/interfaces/slash-dispute";

import { ContractCallPanel } from "./contract-call-panel";

const ID = `0x${"1".repeat(64)}` as const;
const STAKE_ABI = parseAbi([
  "function upholdSlashBatch(bytes32[] requestIds)",
  "function cancelSlashBatch(bytes32[] requestIds)",
]);

const call = (functionName: "upholdSlashBatch" | "cancelSlashBatch"): SlashContractCall => ({
  chainId: "eip155:46630",
  to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c",
  data: encodeFunctionData({ abi: STAKE_ABI, functionName, args: [[ID]] }),
  value: "0",
  signer: ARBITER,
  signerRole: "ARBITER",
  // The server's label, which says "cancel" whatever the calldata does.
  functionName: "cancelSlashBatch",
  requestIds: [ID],
});

const CANCEL = { contract: "stake" as const, functionName: "cancelSlashBatch", args: [[ID]] };

const markup = (c: SlashContractCall) =>
  renderToStaticMarkup(<ContractCallPanel call={c} expected={CANCEL} title="Ruling" afterSend="." />);

/* Operator review 2026-10-15, F1: the panel shows and signs the calldata, not the server's labels. */
describe("ContractCallPanel", () => {
  it("shows the function and arguments decoded from the calldata, and offers signing", () => {
    const html = markup(call("cancelSlashBatch"));
    expect(html).toContain("Function (decoded from the calldata)");
    expect(html).toContain(`[${ID}]`);
    expect(html).toContain("X402Stake");
    expect(html).toContain("Sign and send with the connected wallet");
  });

  it("offers neither signing nor the Safe JSON when the calldata is an uphold labelled as a cancel", () => {
    const html = markup(call("upholdSlashBatch"));
    expect(html).toContain("This is not the transaction you asked for");
    expect(html).toContain("upholdSlashBatch, not cancelSlashBatch");
    expect(html).not.toContain("Sign and send");
    expect(html).not.toContain("Safe Transaction Builder JSON");
  });
});
