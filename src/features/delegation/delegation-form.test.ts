import { describe, expect, it } from "vitest";

import type { EscrowDelegate, Money } from "@/interfaces";

import {
  confirmsDelegateKey,
  type DelegateBinding,
  delegationRows,
  keyFingerprint,
  DEFAULT_DELEGATION_DAYS,
  defaultDelegationForm,
  escrowCanDelegate,
  findDelegation,
  parseDelegationForm,
  supportsDelegation,
} from "./delegation-form";

const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";
const usdg = (amount: string): Money => ({ amount, asset: ASSET, decimals: 6 });
const ESCROW = {
  maxVoucherAmount: usdg("1000000"),
  maxPerWindow: usdg("10000000"),
};
const DELEGATE = "0x5555555555555555555555555555555555555555";
const NOW = 1_800_000_000;

describe("escrowCanDelegate / defaultDelegationForm", () => {
  it("defaults the caps to the escrow's own limits and the expiry to 30 days", () => {
    expect(defaultDelegationForm(ESCROW)).toEqual({
      maxVoucherAmount: "1",
      maxPerWindow: "10",
      validDays: String(DEFAULT_DELEGATION_DAYS),
    });
  });

  it.each([
    ["no escrow", null],
    ["unread limits", { maxVoucherAmount: null, maxPerWindow: null }],
    ["a zero per-payment limit", { ...ESCROW, maxVoucherAmount: usdg("0") }],
    ["a zero window limit", { ...ESCROW, maxPerWindow: usdg("0") }],
  ])("has nothing to hand an agent with %s", (_name, escrow) => {
    expect(escrowCanDelegate(escrow)).toBe(false);
    expect(defaultDelegationForm(escrow)).toBeNull();
  });
});

describe("parseDelegationForm", () => {
  const input = (overrides = {}) => ({
    maxVoucherAmount: "0.5",
    maxPerWindow: "5",
    validDays: "30",
    ...overrides,
  });

  it("builds the intent body in atomic units with validUntil from now", () => {
    expect(parseDelegationForm(input(), ESCROW, DELEGATE, NOW)).toEqual({
      ok: true,
      body: {
        delegate: DELEGATE,
        maxVoucherAmount: "500000",
        maxPerWindow: "5000000",
        validUntil: String(NOW + 30 * 86_400),
      },
    });
  });

  it("admits the escrow's own limits exactly", () => {
    expect(
      parseDelegationForm(
        input({ maxVoucherAmount: "1", maxPerWindow: "10" }),
        ESCROW,
        DELEGATE,
        NOW,
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["a blank cap", { maxVoucherAmount: "" }, "maxVoucherAmount"],
    ["a zero cap", { maxPerWindow: "0" }, "maxPerWindow"],
    ["a negative cap", { maxVoucherAmount: "-1" }, "maxVoucherAmount"],
    ["seven decimals", { maxVoucherAmount: "0.0000001" }, "maxVoucherAmount"],
    [
      "more than the escrow's per-payment limit",
      { maxVoucherAmount: "1.000001" },
      "maxVoucherAmount",
    ],
    [
      "more than the escrow's window limit",
      { maxPerWindow: "10.5" },
      "maxPerWindow",
    ],
    [
      "a per-payment cap above the window cap",
      { maxVoucherAmount: "1", maxPerWindow: "0.5" },
      "maxVoucherAmount",
    ],
    ["zero days", { validDays: "0" }, "validDays"],
    ["more than a year", { validDays: "366" }, "validDays"],
    ["fractional days", { validDays: "1.5" }, "validDays"],
  ])("refuses %s", (_name, patch, field) => {
    const parsed = parseDelegationForm(input(patch), ESCROW, DELEGATE, NOW);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? {} : parsed.errors).toHaveProperty(field);
  });
});

describe("findDelegation / supportsDelegation", () => {
  const delegation = (delegate: string): EscrowDelegate => ({
    delegate,
    maxVoucherAmount: usdg("1"),
    maxPerWindow: usdg("1"),
    spentInWindow: usdg("0"),
    validUntil: "2027-01-01T00:00:00.000Z",
    status: "ACTIVE",
  });

  it("matches a delegate by address, whatever the case", () => {
    const found = findDelegation(
      [delegation(`eip155:46630:${DELEGATE}`)],
      `eip155:46630:${DELEGATE.toUpperCase().replace("0X", "0x")}`,
    );
    expect(found?.delegate).toBe(`eip155:46630:${DELEGATE}`);
    expect(
      findDelegation(
        [delegation(`eip155:46630:${DELEGATE}`)],
        "eip155:46630:0x6666666666666666666666666666666666666666",
      ),
    ).toBeNull();
    expect(findDelegation(undefined, DELEGATE)).toBeNull();
  });

  it("offers delegation on eip155 only", () => {
    expect(
      supportsDelegation(
        "eip155:46630:0x18103e1D79257c695B2FBbd4b346CD2Ba7927296",
      ),
    ).toBe(true);
    expect(
      supportsDelegation("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:9WzD"),
    ).toBe(false);
    expect(supportsDelegation(undefined)).toBe(false);
  });
});

describe("delegationRows (review S2-5)", () => {
  const grant = (delegate: string): EscrowDelegate => ({
    delegate: `eip155:46630:${delegate}`,
    maxVoucherAmount: usdg("1"),
    maxPerWindow: usdg("1"),
    spentInWindow: usdg("0"),
    validUntil: "2027-01-01T00:00:00.000Z",
    status: "ACTIVE",
  });
  const binding = (
    delegate: string,
    revokedAt: string | null,
    credentialId = "c1",
  ): DelegateBinding => ({
    agentId: "a1",
    agentLabel: "agent",
    credentialId,
    credentialName: "laptop",
    delegateAccount: `eip155:46630:${delegate.toUpperCase().replace("0X", "0x")}`,
    delegateBoundAt: "2026-10-01T00:00:00.000Z",
    revokedAt,
  });
  const LIVE = "0x5555555555555555555555555555555555555555";
  const ORPHAN = "0x6666666666666666666666666666666666666666";
  const REVOKED_CRED = "0x7777777777777777777777777777777777777777";

  it("lists EVERY on-chain grant — including one no live credential is bound to", () => {
    const rows = delegationRows(
      [grant(LIVE), grant(ORPHAN), grant(REVOKED_CRED)],
      [
        binding(LIVE, null),
        binding(REVOKED_CRED, "2026-10-05T00:00:00.000Z", "c2"),
      ],
    );
    expect(
      rows.map((r) => [
        r.delegation.delegate.split(":")[2],
        r.bound,
        r.bindings.length,
      ]),
    ).toEqual([
      [LIVE, true, 1],
      [ORPHAN, false, 0],
      [REVOKED_CRED, false, 1],
    ]);
  });

  it("lists nothing when there is nothing on chain, whatever the credentials say", () => {
    expect(delegationRows([], [binding(LIVE, null)])).toEqual([]);
    expect(delegationRows(undefined, [binding(LIVE, null)])).toEqual([]);
  });
});

describe("confirmsDelegateKey (review S3-9)", () => {
  const KEY = "eip155:46630:0x9C49bbE9a1Acb13D831cb54316C67B1c188E469a";
  it("accepts exactly the key's last four characters, in any case", () => {
    expect(keyFingerprint(KEY)).toBe("469a");
    expect(confirmsDelegateKey("469A", KEY)).toBe(true);
    expect(confirmsDelegateKey(" 469a ", KEY)).toBe(true);
  });
  it.each(["", "469", "469b", "9469a", "e469"])("refuses %p", (typed) => {
    expect(confirmsDelegateKey(typed, KEY)).toBe(false);
  });
});
