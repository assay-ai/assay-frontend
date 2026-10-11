import { describe, expect, it } from "vitest";

import type { EscrowDelegate, Money } from "@/interfaces";

import {
  capsAboveEscrow,
  confirmsDelegateKey,
  type DelegateBinding,
  delegationRows,
  keyFingerprint,
  DEFAULT_DELEGATION_DAYS,
  defaultDelegationForm,
  editDelegationForm,
  errorsAfterEdit,
  escrowCanDelegate,
  findDelegation,
  parseDelegationForm,
  serverNowSeconds,
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

/** REGRESSION (BUG-D1-05): "30 days" was counted from when the page loaded. */
describe("serverNowSeconds", () => {
  const read = "2026-10-12T12:17:17.000Z";
  const readAt = Date.parse("2026-10-12T12:17:17.000Z") + 3_000; // browser 3 s ahead

  it("carries the server's instant forward by the time elapsed since it was read", () => {
    const fifteenMinutesLater = readAt + 15 * 60_000;
    expect(serverNowSeconds(read, readAt, fifteenMinutesLater)).toBe(
      Date.parse(read) / 1000 + 15 * 60,
    );
  });

  it("so a sheet signed later expires later, by exactly that much", () => {
    const form = { maxVoucherAmount: "0.5", maxPerWindow: "2", validDays: "30" };
    const at = (ms: number) =>
      parseDelegationForm(form, ESCROW, DELEGATE, serverNowSeconds(read, readAt, ms));
    const early = at(readAt);
    const late = at(readAt + 15 * 60_000);
    if (!early.ok || !late.ok) throw new Error("expected valid forms");
    expect(Number(late.body.validUntil) - Number(early.body.validUntil)).toBe(15 * 60);
  });

  it("falls back to the browser clock without a server reading", () => {
    expect(serverNowSeconds(undefined, 0, 1_800_000_000_000)).toBe(1_800_000_000);
  });
});

/** REGRESSION (BUG-D1-05): an error stayed under a field after the field was fixed. */
describe("errorsAfterEdit", () => {
  it("clears the edited field's error, and the cross-check either amount can fix", () => {
    const errors = {
      maxVoucherAmount: "Cannot be more than the per-window cap.",
      validDays: "Between 1 and 365 days.",
    };
    expect(errorsAfterEdit(errors, "maxVoucherAmount")).toEqual({
      validDays: "Between 1 and 365 days.",
    });
    expect(errorsAfterEdit(errors, "maxPerWindow")).toEqual({
      validDays: "Between 1 and 365 days.",
    });
    expect(errorsAfterEdit(errors, "validDays")).toEqual({
      maxVoucherAmount: "Cannot be more than the per-window cap.",
    });
  });
});

/** BUG-D1-04: "Edit limits" starts from the standing grant. */
describe("editDelegationForm", () => {
  it("prefills the grant's caps and the days it has left", () => {
    const grant = {
      maxVoucherAmount: usdg("500000"),
      maxPerWindow: usdg("2000000"),
      validUntil: new Date((NOW + 29.2 * 86_400) * 1000).toISOString(),
    };
    expect(editDelegationForm(grant, NOW)).toEqual({
      maxVoucherAmount: "0.5",
      maxPerWindow: "2",
      validDays: "30",
    });
  });

  it("never offers fewer than one day", () => {
    const lapsed = {
      maxVoucherAmount: usdg("1"),
      maxPerWindow: usdg("1"),
      validUntil: new Date((NOW - 86_400) * 1000).toISOString(),
    };
    expect(editDelegationForm(lapsed, NOW).validDays).toBe("1");
  });
});

/** BUG-D1-03: a grant made under higher escrow limits, after the limits were lowered. */
describe("capsAboveEscrow", () => {
  const grant = { maxVoucherAmount: usdg("500000"), maxPerWindow: usdg("2000000") };

  it("names each cap the escrow no longer allows", () => {
    expect(capsAboveEscrow(grant, { ...ESCROW, maxVoucherAmount: usdg("50000") })).toEqual({
      maxVoucherAmount: usdg("50000"),
    });
    expect(
      capsAboveEscrow(grant, { maxVoucherAmount: usdg("50000"), maxPerWindow: usdg("1000000") }),
    ).toEqual({ maxVoucherAmount: usdg("50000"), maxPerWindow: usdg("1000000") });
  });

  it("is empty while the escrow allows both", () => {
    expect(capsAboveEscrow(grant, ESCROW)).toEqual({});
    expect(capsAboveEscrow(grant, null)).toEqual({});
  });
});
