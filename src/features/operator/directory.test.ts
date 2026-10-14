import { describe, expect, it } from "vitest";

import type { OperatorDirectoryEntry } from "@/interfaces/operator";
import { checkEvmAddress } from "@/libs/chains/evm/operator-wallet";

import {
  limitInputOf,
  mayEditRow,
  mayManageOperators,
  validateAddOperator,
  validateChangeOperator,
  validateRemoveOperator,
  type AddOperatorInput,
} from "./directory";

const CHECKSUMMED = "0x52908400098527886E0F7030069857D2E4169EE7";
const NOTE = "Joins the adjudication team.";

const valid: AddOperatorInput = {
  walletAddress: CHECKSUMMED,
  subject: " dan@ ",
  displayName: "",
  roles: ["ADJ"],
  limit: { mode: "zero", amount: "" },
  reasonCode: "NEW_HIRE",
  note: NOTE,
};

const row: Pick<OperatorDirectoryEntry, "id" | "status" | "roles" | "authorityLimit"> = {
  id: "o1",
  status: "ACTIVE",
  roles: ["ADJ"],
  authorityLimit: { amount: "1000000", asset: "eip155:46630/erc20:0x1", decimals: 6 },
};

describe("the wallet address (EIP-55)", () => {
  it("accepts a correct checksum and plain lower-case, and returns the checksummed form", () => {
    expect(checkEvmAddress(CHECKSUMMED)).toEqual({ ok: true, checksummed: CHECKSUMMED });
    expect(checkEvmAddress(CHECKSUMMED.toLowerCase())).toEqual({ ok: true, checksummed: CHECKSUMMED });
  });

  it("refuses mixed case that does not match the checksum", () => {
    const wrong = CHECKSUMMED.replace("E0F", "e0F");
    const result = checkEvmAddress(wrong);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/EIP-55/);
  });

  it("refuses anything that is not 0x and 40 hex characters", () => {
    expect(checkEvmAddress("0x1234").ok).toBe(false);
    expect(checkEvmAddress("52908400098527886E0F7030069857D2E4169EE7").ok).toBe(false);
  });
});

describe("validateAddOperator", () => {
  it("builds the body: checksummed wallet, trimmed subject, limit 0", () => {
    expect(validateAddOperator(valid)).toEqual({
      ok: true,
      body: {
        walletAddress: CHECKSUMMED,
        subject: "dan@",
        roles: ["ADJ"],
        authorityLimitMinor: "0",
        reasonCode: "NEW_HIRE",
        note: NOTE,
      },
    });
  });

  it("sends null for an unbounded limit and the digits for an amount", () => {
    const unbounded = validateAddOperator({ ...valid, limit: { mode: "unbounded", amount: "" } });
    expect(unbounded.ok && unbounded.body.authorityLimitMinor).toBeNull();
    const amount = validateAddOperator({ ...valid, limit: { mode: "amount", amount: "250000000" } });
    expect(amount.ok && amount.body.authorityLimitMinor).toBe("250000000");
  });

  it("names every wrong field", () => {
    const result = validateAddOperator({
      walletAddress: CHECKSUMMED.replace("E0F", "e0F"),
      subject: "  ",
      displayName: "x".repeat(129),
      roles: [],
      limit: { mode: "amount", amount: "1.5" },
      reasonCode: "",
      note: "short",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["displayName", "limit", "note", "reasonCode", "roles", "subject", "walletAddress"].sort(),
    );
  });

  it("refuses a limit with a leading zero", () => {
    expect(validateAddOperator({ ...valid, limit: { mode: "amount", amount: "01" } }).ok).toBe(false);
  });
});

describe("validateChangeOperator", () => {
  const base = { reasonCode: "ROLE_CHANGE", note: NOTE };

  it("sends only what changed", () => {
    expect(
      validateChangeOperator(row, { roles: ["ADJ", "ADJL"], limit: limitInputOf(row), ...base }),
    ).toEqual({ ok: true, body: { roles: ["ADJ", "ADJL"], ...base } });
    expect(
      validateChangeOperator(row, { roles: ["ADJ"], limit: { mode: "unbounded", amount: "" }, ...base }),
    ).toEqual({ ok: true, body: { authorityLimitMinor: null, ...base } });
  });

  it("refuses a change that changes nothing, and an empty role set", () => {
    const same = validateChangeOperator(row, { roles: ["ADJ"], limit: limitInputOf(row), ...base });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors.change).toMatch(/Nothing changed/);
    const none = validateChangeOperator(row, { roles: [], limit: limitInputOf(row), ...base });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors.roles).toBeDefined();
  });

  it("reads the row's limit back into the form", () => {
    expect(limitInputOf(row)).toEqual({ mode: "amount", amount: "1000000" });
    expect(limitInputOf({ authorityLimit: null })).toEqual({ mode: "unbounded", amount: "" });
  });
});

describe("validateRemoveOperator", () => {
  it("needs a reason code and a note of ten characters", () => {
    expect(validateRemoveOperator({ reasonCode: "", note: "short" }).ok).toBe(false);
    expect(validateRemoveOperator({ reasonCode: "LEFT", note: NOTE })).toEqual({
      ok: true,
      body: { reasonCode: "LEFT", note: NOTE },
    });
  });
});

describe("who may write", () => {
  it("is OPS_ADMIN only", () => {
    expect(mayManageOperators(["OPS_ADMIN"])).toBe(true);
    expect(mayManageOperators(["ADJL", "SEC"])).toBe(false);
  });

  it("never offers edit or remove on your own row, or to a non-admin, or on a removed row", () => {
    const admin = { id: "me", roles: ["OPS_ADMIN"] as const };
    expect(mayEditRow({ ...admin, roles: [...admin.roles] }, row)).toBe(true);
    expect(mayEditRow({ ...admin, roles: [...admin.roles] }, { ...row, id: "me" })).toBe(false);
    expect(mayEditRow({ id: "me", roles: ["ADJL"] }, row)).toBe(false);
    expect(mayEditRow({ ...admin, roles: [...admin.roles] }, { ...row, status: "REMOVED" })).toBe(false);
  });
});
