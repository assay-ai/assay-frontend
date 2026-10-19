import { describe, expect, it } from "vitest";

import {
  buildConfigCall,
  labelBytes32,
  labelText,
  verifierRow,
  type ConfigParams,
  type ContractSettings,
  type VerifierKeyRow,
} from "@/libs/chains/evm/contract-config";
import { assertContractCall, decodePinnedCall } from "@/libs/chains/evm/signing-guard";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";

import { callAction } from "./call-summary";
import {
  checkNewArbiter,
  checkNewVerifier,
  checkSlashDelay,
  confirmWordMatches,
  daysToSeconds,
  dollars,
  delayToForm,
  formToParams,
  moneyToRaw,
  paramChanges,
  paramsToForm,
  paramText,
  percentToBps,
  splitText,
  verifierStatusText,
} from "./contract-settings";
import { operatorNavFor } from "./nav";

// The testnet's values on 2026-10-17.
const PARAMS: ConfigParams = {
  treasury: "0x4246bee428758e8215bA587717d48B8Ef0130388",
  redeemer: "0x24A2c5823204150fe1bdc5Ce378A704788B345DB",
  unbondingPeriodSeconds: BigInt(950_400),
  minimumStake: BigInt(100_000_000),
  penaltyAmount: BigInt(1_000_000),
  verifierDailyCap: BigInt(500_000_000),
  takeRateBps: 1000,
  slashAgentBps: 6000,
  slashPlatformBps: 3000,
  slashCapBps: 1000,
};
const ASSET = { decimals: 6, symbol: "USDG" };
const ADMIN = "0xD9a229c2847929ecAEfc83C17519FCA53Fd20D32";
const ARBITER = "0x925f502eecE8C306097EC456062A12e5475C8ee1";
const VERIFIER = "0x18A508C9AF1c6fc512015276F6ca2E9aaBd74680";
const SETTINGS: Pick<ContractSettings, "admin" | "arbiter" | "params"> = { admin: ADMIN, arbiter: ARBITER, params: PARAMS };
const NOW = 1_792_000_000;
const KEYS: VerifierKeyRow[] = [
  verifierRow(VERIFIER, "e2e-verifier", { registeredAt: BigInt(NOW - 86_400), expiresAt: BigInt(NOW + 20 * 86_400), revokedAt: BigInt(0), revoked: false }, NOW),
];
const context = { ...ASSET, arbiter: ARBITER } as const;

describe("units", () => {
  it("reads percents, days and money as typed", () => {
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("12.5")).toBe(1250);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps("1.234")).toBeNull();
    expect(percentToBps("-1")).toBeNull();
    expect(daysToSeconds("11")).toBe(BigInt(950_400));
    expect(daysToSeconds("abc")).toBeNull();
    expect(moneyToRaw("1.5", 6)).toBe(BigInt(1_500_000));
    expect(moneyToRaw("1,000", 6)).toBe(BigInt(1_000_000_000));
    expect(moneyToRaw("0.0000001", 6)).toBeNull();
    expect(moneyToRaw("99999999999999999", 6)).toBeNull();
  });

  it("shows the current settings in the same units, and round-trips them unchanged", () => {
    const form = paramsToForm(PARAMS, 6);
    expect(form).toMatchObject({ takeRateBps: "10", minimumStake: "100", penaltyAmount: "1", unbondingPeriodSeconds: "11", slashCapBps: "10" });
    const checked = formToParams(form, context);
    expect(checked.ok && paramChanges(PARAMS, checked.params, ASSET)).toEqual([]);
  });
});

describe("formToParams mirrors AssayConfig._validate", () => {
  const form = paramsToForm(PARAMS, 6);
  const errorsOf = (patch: Partial<typeof form>) => {
    const checked = formToParams({ ...form, ...patch }, context);
    return checked.ok ? {} : checked.errors;
  };

  it("refuses what the contract refuses, on the field it is about", () => {
    expect(errorsOf({ takeRateBps: "31" }).takeRateBps).toMatch(/at most 30%/);
    expect(errorsOf({ slashAgentBps: "0" }).slashAgentBps).toMatch(/more than 0%/);
    expect(errorsOf({ slashAgentBps: "70", slashPlatformBps: "40" }).slashPlatformBps).toMatch(/110%/);
    expect(errorsOf({ slashCapBps: "51" }).slashCapBps).toBeDefined();
    expect(errorsOf({ unbondingPeriodSeconds: "10" }).unbondingPeriodSeconds).toMatch(/11 to 30/);
    expect(errorsOf({ minimumStake: "0" }).minimumStake).toBeDefined();
    expect(errorsOf({ treasury: "0x0000000000000000000000000000000000000000" }).treasury).toBeDefined();
    expect(errorsOf({ redeemer: "0x123" }).redeemer).toMatch(/wallet address/);
    expect(errorsOf({ redeemer: ARBITER.toLowerCase() }).redeemer).toMatch(/arbiter/);
  });

  it("checks that two penalties fit the minimum stake's cap and the verifier's day", () => {
    // 10% of 100 = 10; two penalties of 6 = 12 do not fit.
    expect(errorsOf({ penaltyAmount: "6" }).penaltyAmount).toMatch(/10% of \$100\.00 is \$10\.00/);
    expect(errorsOf({ penaltyAmount: "5" }).penaltyAmount).toBeUndefined();
    expect(errorsOf({ verifierDailyCap: "1.5" }).verifierDailyCap).toMatch(/\$2\.00 or more/);
    // A penalty of 0 (shadow mode) needs no allowance.
    expect(errorsOf({ penaltyAmount: "0" })).toEqual({});
  });

  it("writes money in dollars, never in the token's symbol (B12)", () => {
    expect(paramText("penaltyAmount", PARAMS, ASSET)).toMatch(/^\$\d/);
    expect(paramText("minimumStake", PARAMS, ASSET)).not.toMatch(/USDG/);
    expect(dollars(BigInt(1_000_000), 6)).toBe("$1.00");
    expect(dollars(BigInt(500_000_000), 6)).toBe("$500.00");
  });

  it("lists only what changed, addresses flagged", () => {
    const checked = formToParams({ ...form, takeRateBps: "12.5", treasury: VERIFIER }, context);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(paramChanges(PARAMS, checked.params, ASSET)).toEqual([
      { key: "takeRateBps", label: "Platform fee", before: "10%", after: "12.5%", critical: false },
      expect.objectContaining({ key: "treasury", critical: true }),
    ]);
  });

  it("says the split in words", () => {
    expect(splitText(PARAMS)).toBe("60% to the agent, 30% to the treasury, 10% stays with the provider");
  });
});

describe("the arbiter, verifier keys and the dispute window", () => {
  it("refuses an arbiter the contract would refuse", () => {
    expect(checkNewArbiter(ADMIN, SETTINGS, KEYS)).toMatchObject({ ok: false, error: expect.stringMatching(/admin/) });
    expect(checkNewArbiter(PARAMS.redeemer, SETTINGS, KEYS)).toMatchObject({ ok: false, error: expect.stringMatching(/redeemer/) });
    expect(checkNewArbiter(VERIFIER, SETTINGS, KEYS)).toMatchObject({ ok: false, error: expect.stringMatching(/verifier/) });
    expect(checkNewArbiter(ARBITER.toLowerCase(), SETTINGS, KEYS)).toMatchObject({ ok: false, error: expect.stringMatching(/already/) });
    expect(checkNewArbiter("0x1111111111111111111111111111111111111111", SETTINGS, KEYS)).toEqual({
      ok: true,
      address: "0x1111111111111111111111111111111111111111",
    });
  });

  it("registers a key once, never for a role holder, for at most a year", () => {
    const ok = checkNewVerifier({ address: "0x2222222222222222222222222222222222222222", label: "prod-1", days: "90" }, SETTINGS, KEYS, NOW);
    expect(ok).toMatchObject({ ok: true, expiresAt: BigInt(NOW + 90 * 86_400) });
    const errors = (form: { address: string; label: string; days: string }) => {
      const checked = checkNewVerifier(form, SETTINGS, KEYS, NOW);
      return checked.ok ? {} : checked.errors;
    };
    expect(errors({ address: VERIFIER, label: "x", days: "30" }).address).toMatch(/already registered/);
    expect(errors({ address: ADMIN, label: "x", days: "30" }).address).toMatch(/admin/);
    expect(errors({ address: ARBITER, label: "x", days: "30" }).address).toMatch(/arbiter/);
    expect(errors({ address: "0x2222222222222222222222222222222222222222", label: "", days: "366" })).toMatchObject({
      label: expect.any(String),
      days: expect.any(String),
    });
    // A year stays inside the contract's ceiling.
    const year = checkNewVerifier({ address: "0x2222222222222222222222222222222222222222", label: "y", days: "365" }, SETTINGS, KEYS, NOW);
    expect(year.ok && year.expiresAt < BigInt(NOW + 365 * 86_400)).toBe(true);
  });

  it("names a key's state", () => {
    expect(verifierStatusText(KEYS[0]!, NOW)).toBe("Expires in 20 days");
    expect(verifierStatusText({ ...KEYS[0]!, status: "expired", expiresAt: NOW - 3 * 86_400 }, NOW)).toBe("Expired 3 days ago");
    expect(verifierStatusText({ ...KEYS[0]!, status: "revoked" }, NOW)).toBe("Revoked");
  });

  it("keeps the dispute window inside 10 minutes to 22 days", () => {
    expect(delayToForm(259_200)).toEqual({ value: "3", unit: "days" });
    expect(delayToForm(5400)).toEqual({ value: "90", unit: "minutes" });
    expect(checkSlashDelay("5", "minutes", 259_200).ok).toBe(false);
    expect(checkSlashDelay("23", "days", 259_200).ok).toBe(false);
    expect(checkSlashDelay("3", "days", 259_200)).toMatchObject({ ok: false, error: /current/ });
    expect(checkSlashDelay("48", "hours", 259_200)).toEqual({ ok: true, seconds: 172_800 });
  });

  it("matches a typed confirmation word loosely", () => {
    expect(confirmWordMatches(" pause ", "PAUSE")).toBe(true);
    expect(confirmWordMatches("paus", "PAUSE")).toBe(false);
  });
});

describe("the admin's calls", () => {
  it("round-trips a key label through bytes32", () => {
    expect(labelText(labelBytes32("e2e-verifier"))).toBe("e2e-verifier");
    expect(() => labelBytes32("x".repeat(33))).toThrow();
  });

  it("builds calls the signing guard decodes back to exactly what was chosen", () => {
    const checked = formToParams({ ...paramsToForm(PARAMS, 6), takeRateBps: "12" }, context);
    if (!checked.ok) throw new Error("form");
    const calls = [
      { functionName: "setPaused", args: [true] },
      { functionName: "updateConfig", args: [checked.params] },
      { functionName: "registerVerifier", args: ["0x2222222222222222222222222222222222222222", labelBytes32("k"), BigInt(NOW)] },
      { functionName: "revokeVerifier", args: [VERIFIER] },
      { functionName: "setArbiter", args: ["0x1111111111111111111111111111111111111111"] },
      { functionName: "setSlashDelay", args: [BigInt(600)] },
    ] as const;
    for (const chosen of calls) {
      const { call, expected } = buildConfigCall(ROBINHOOD_TESTNET_STAKE, ADMIN, chosen as never);
      expect(call).toMatchObject({ to: ROBINHOOD_TESTNET_STAKE.configContract, value: "0", signer: ADMIN, signerRole: "ADMIN" });
      expect(assertContractCall(call, expected).functionName).toBe(chosen.functionName);
    }
  });

  it("refuses a ParamSet that differs in one field", () => {
    const { call } = buildConfigCall(ROBINHOOD_TESTNET_STAKE, ADMIN, {
      functionName: "updateConfig",
      args: [PARAMS],
    });
    const other = { ...PARAMS, treasury: VERIFIER };
    expect(() =>
      assertContractCall(call, { contract: "config", functionName: "updateConfig", args: [other] }),
    ).toThrow(/not what you chose/);
    expect(decodePinnedCall(call).functionName).toBe("updateConfig");
  });

  it("says each call in words", () => {
    expect(callAction("setPaused", [true])).toMatch(/^Pause the contracts/);
    expect(callAction("setPaused", [false])).toBe("Resume the contracts");
    expect(callAction("setSlashDelay", [BigInt(259_200)])).toBe("Set the penalty dispute window to 3 days");
    expect(callAction("revokeVerifier", [VERIFIER])).toMatch(/^Revoke verifier key 0x18A5/);
  });
});

describe("the Contracts nav item", () => {
  it("shows only to Admin", () => {
    expect(operatorNavFor(["OPS_ADMIN"]).map((item) => item.id)).toContain("contracts");
    expect(operatorNavFor(["ADJL"]).map((item) => item.id)).not.toContain("contracts");
  });
});
