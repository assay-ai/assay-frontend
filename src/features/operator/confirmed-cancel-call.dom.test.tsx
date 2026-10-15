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

import { ConfirmedCancelCall, cancelledRequestIdOf } from "./confirmed-cancel-call";

const OURS = `0x${"1".repeat(64)}`;
const OTHER = `0x${"2".repeat(64)}`;

// A server that labels the call with this case's id but encodes another one.
const call = (encoded: string, signature = "cancelSlash(bytes32)"): SlashContractCall => ({
  chainId: "eip155:46630",
  to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c",
  data: encodeCall(signature, [encoded]),
  value: "0",
  signer: ARBITER,
  signerRole: "ARBITER",
  functionName: "cancelSlash",
  requestIds: [OURS],
});

/* Frontend review N3: the cancel is checked against the id the operator ticks, not the server's label. */
describe("ConfirmedCancelCall", () => {
  it("reads the id from the calldata, not the label", () => {
    expect(cancelledRequestIdOf(call(OTHER))).toBe(OTHER);
    expect(cancelledRequestIdOf(call(OTHER, "upholdSlash(bytes32)"))).toBeNull();
  });

  it("shows the decoded id and offers no signing until the operator ticks it", () => {
    const html = renderToStaticMarkup(<ConfirmedCancelCall call={call(OTHER)} title="Cancel" afterSend="." />);
    expect(html).toContain(OTHER);
    expect(html).toContain("I checked that this request id is this case");
    expect(html).not.toContain("Sign and send");
    expect(html).not.toContain("Safe Transaction Builder JSON");
  });

  it("refuses a call that is not a single-record cancelSlash", () => {
    const html = renderToStaticMarkup(
      <ConfirmedCancelCall call={call(OTHER, "upholdSlash(bytes32)")} title="Cancel" afterSend="." />,
    );
    expect(html).toContain("not offered for signing");
    expect(html).not.toContain("Sign and send");
  });
});
