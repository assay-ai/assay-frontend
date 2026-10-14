import { describe, expect, it } from "vitest";

import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { slashStatusOf } from "@/libs/chains/evm/stake-slashes/status";
import { ApiError } from "@/libs/ApiClient";

import {
  MAX_DISPUTE_SELECTION,
  disputeErrorMessage,
  isDisputeSelectable,
  notSelectableReason,
  pruneDisputeSelection,
  selectAllDisputable,
  toggleDisputeSelection,
} from "./dispute-selection";

const NOW = 10_000_000;

function row(n: number, status = 1, executableAt = NOW + 3_600): ChainSlashRow {
  return {
    requestId: `0x${n.toString(16).padStart(64, "0")}` as HexString,
    status: slashStatusOf(status),
    cancelReason: null,
    penalty: BigInt(1),
    reserved: BigInt(1),
    applied: null,
    beneficiary: "0x64fecbe18e8998cb2990bce631a042f8e2be1659" as HexString,
    proposedAt: NOW - 3_600,
    executableAt,
    disputedAt: null,
    disputeExpiresAt: null,
    upheld: false,
    disputeTx: null,
    proposeTx: null,
    closeTx: null,
    stateSource: "record",
  };
}

describe("which rows may be selected for an on-chain dispute", () => {
  it("allows a Pending row inside its window on the provider's own wallet", () => {
    expect(notSelectableReason(row(1), NOW, true)).toBeNull();
    expect(isDisputeSelectable(row(1), NOW, true)).toBe(true);
  });

  it("refuses every row on an address that is not the signed-in provider's own", () => {
    expect(notSelectableReason(row(1), NOW, false)).toBe("not-own-wallet");
  });

  it("refuses a row that is not Pending", () => {
    for (const status of [2, 3, 4, 9]) {
      expect(notSelectableReason(row(1, status), NOW, true)).toBe("not-pending");
    }
  });

  it("uses the row's own executableAt, not a fixed 72 hours", () => {
    // A one-hour delay: still open 59 minutes in, closed at the hour.
    const shortDelay = row(1, 1, NOW + 60);
    expect(isDisputeSelectable(shortDelay, NOW, true)).toBe(true);
    expect(notSelectableReason(shortDelay, NOW + 60, true)).toBe("window-closed");
    // A ten-day delay is open long after 72 hours.
    const longDelay = row(2, 1, NOW + 10 * 86_400);
    expect(isDisputeSelectable(longDelay, NOW + 4 * 86_400, true)).toBe(true);
  });
});

describe("toggleDisputeSelection", () => {
  it("selects and unselects", () => {
    const first = toggleDisputeSelection(new Set(), row(1), NOW, true);
    expect(first.ok).toBe(true);
    expect([...first.selected]).toEqual([row(1).requestId]);
    const second = toggleDisputeSelection(first.selected, row(1), NOW, true);
    expect(second.selected.size).toBe(0);
  });

  it("stops at 64", () => {
    expect(MAX_DISPUTE_SELECTION).toBe(64);
    let selected: ReadonlySet<string> = new Set();
    for (let n = 1; n <= 64; n += 1) selected = toggleDisputeSelection(selected, row(n), NOW, true).selected;
    expect(selected.size).toBe(64);
    const refused = toggleDisputeSelection(selected, row(65), NOW, true);
    expect(refused).toMatchObject({ ok: false, reason: "limit" });
    expect(refused.selected.size).toBe(64);
    // Unselecting still works at the limit.
    expect(toggleDisputeSelection(selected, row(64), NOW, true).selected.size).toBe(63);
  });

  it("refuses a row that is not selectable, whatever the count", () => {
    expect(toggleDisputeSelection(new Set(), row(1, 4), NOW, true)).toMatchObject({ ok: false, reason: "not-selectable" });
    expect(toggleDisputeSelection(new Set(), row(1), NOW, false)).toMatchObject({ ok: false, reason: "not-selectable" });
  });
});

describe("selectAllDisputable", () => {
  it("adds only selectable rows, up to 64", () => {
    const rows = [row(1, 2), ...Array.from({ length: 70 }, (_, i) => row(i + 2))];
    const selected = selectAllDisputable(new Set(), rows, NOW, true);
    expect(selected.size).toBe(64);
    expect(selected.has(row(1).requestId)).toBe(false);
  });

  it("selects nothing on someone else's address", () => {
    expect(selectAllDisputable(new Set(), [row(1)], NOW, false).size).toBe(0);
  });
});

describe("pruneDisputeSelection", () => {
  it("drops rows whose window closed or that became Disputed, and keeps the same set when nothing changed", () => {
    const selected = new Set([row(1).requestId, row(2).requestId]);
    const same = pruneDisputeSelection(selected, [row(1), row(2)], NOW, true);
    expect(same).toBe(selected);
    const pruned = pruneDisputeSelection(selected, [row(1, 4), row(2, 1, NOW - 1)], NOW, true);
    expect(pruned.size).toBe(0);
    expect(pruneDisputeSelection(selected, [row(1), row(2)], NOW, false).size).toBe(0);
  });
});

describe("disputeErrorMessage", () => {
  it("explains a 422 as a refused batch, with the rows marked", () => {
    expect(disputeErrorMessage(new ApiError("SLASH_CHAIN_BATCH_REFUSED", "x", 422), "x")).toMatch(
      /refuse the whole batch.*marked below/,
    );
  });

  it("names the refused batch from error.context", () => {
    const error = new ApiError("SLASH_CHAIN_BATCH_REFUSED", "x", 422, undefined, { functionName: "disputeSlashBatch" });
    expect(disputeErrorMessage(error, "x")).toMatch(/refuse the whole disputeSlashBatch\./);
  });

  it("labels a pause and an on-chain block", () => {
    expect(disputeErrorMessage(new ApiError("CHAIN_PROGRAM_PAUSED", "paused", 503), "x")).toMatch(
      /^Contracts paused — try after unpause/,
    );
    expect(disputeErrorMessage(new ApiError("CHAIN_ADDRESS_BLOCKED", "blocked", 403), "x")).toMatch(
      /^Blocked on chain/,
    );
  });

  it("passes a wallet or network error's own message through", () => {
    expect(disputeErrorMessage(new Error("boom"), "x")).toBe("boom");
  });
});
