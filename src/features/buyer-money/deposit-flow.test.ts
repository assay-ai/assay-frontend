import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const service = vi.hoisted(() => ({
  createDeposit: vi.fn(),
  getDeposit: vi.fn(),
  settleDeposit: vi.fn(),
  settleDepositByBroadcast: vi.fn(),
}));
const evm = vi.hoisted(() => ({ sendEvmDepositFor: vi.fn(), checkEvmDeposit: vi.fn(), approveEvmDeposit: vi.fn() }));

vi.mock("@/services/funding.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/funding.service")>()),
  ...service,
}));
vi.mock("@/features/funding/evm-deposit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/funding/evm-deposit")>()),
  ...evm,
}));
vi.mock("@/libs/chains/evm/deposit-transaction", () => ({ waitForSuccess: vi.fn(async () => undefined) }));

import type { Signer } from "@/hooks/useSigner";

import { DepositNoAnswer, DepositStillChecking, isNoAnswer, runDepositStep, type DepositRun } from "./deposit-flow";
import { describeMoneyError, describeSubmittedDepositError, DEPOSIT_NOT_OBSERVED_TEXT } from "./money-errors";

const CHAIN = "eip155:46630";
const RAW = "0xf86c" as `0x${string}`;
const signer = { address: "0xbuyer", kind: "embedded", chainId: CHAIN } as unknown as Signer;

const timeout = () => new ApiError("ECONNABORTED", "timeout of 30000ms exceeded", 0);
const failedToFetch = () => new ApiError("ERR_NETWORK", "Network Error", 0);

function deposit(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    status,
    statusReason: null,
    settledAmount: status === "SETTLED" ? { amount: "5000000", asset: "x" } : null,
    chainTxRef: status === "SETTLED" ? "0xabc" : null,
    ...extra,
  };
}

function freshRun(): DepositRun {
  return { chainId: CHAIN, amountAtomic: "5000000", created: null, createdAt: 0 };
}

const hooks = () => ({ onWallet: vi.fn(), onSubmitted: vi.fn(), onSigned: vi.fn() });

/** Runs the step, letting the re-read backoff elapse. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const settled = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await settled;
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

beforeEach(() => {
  vi.useFakeTimers();
  service.createDeposit.mockResolvedValue({
    depositId: "dep-1",
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    requirements: { namespace: "eip155", chainId: CHAIN },
  });
  evm.sendEvmDepositFor.mockResolvedValue({ kind: "signed", rawTransaction: RAW });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("isNoAnswer", () => {
  it("is the axios timeout, a network error and Failed to fetch, never an answered refusal", () => {
    expect(isNoAnswer(timeout())).toBe(true);
    expect(isNoAnswer(failedToFetch())).toBe(true);
    expect(isNoAnswer(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNoAnswer(new ApiError("PAYMENT_SETTLEMENT_FAILED", "x", 502))).toBe(false);
  });
});

describe("a settle whose answer was lost after the deposit was signed (BUG-PROD-DEPOSIT-01)", () => {
  it("re-reads the deposit and reports it deposited when it SETTLED, with no second settle", async () => {
    service.settleDeposit.mockRejectedValue(timeout());
    service.getDeposit.mockResolvedValueOnce(deposit("SETTLING")).mockResolvedValueOnce(deposit("SETTLED"));
    const result = await settle(runDepositStep(freshRun(), signer, hooks()));
    expect(result).toEqual({ id: "dep-1", status: "SETTLED", settledAmount: expect.anything(), chainTxRef: "0xabc" });
    expect(service.settleDeposit).toHaveBeenCalledTimes(1);
    expect(evm.sendEvmDepositFor).toHaveBeenCalledTimes(1);
  });

  it("says the transfer was not seen when the deposit FAILED", async () => {
    service.settleDeposit.mockRejectedValue(failedToFetch());
    service.getDeposit.mockResolvedValue(deposit("FAILED", { statusReason: "no transfer was observed" }));
    const error = await settle(runDepositStep(freshRun(), signer, hooks())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("PAYMENT_DEPOSIT_TRANSFER_NOT_OBSERVED");
    expect(describeSubmittedDepositError(error)).toEqual({ text: DEPOSIT_NOT_OBSERVED_TEXT, tone: "danger" });
    expect(service.settleDeposit).toHaveBeenCalledTimes(1);
  });

  it("ends on still checking (a warning, not the raw timeout) when it stays SETTLING", async () => {
    service.settleDeposit.mockRejectedValue(timeout());
    service.getDeposit.mockResolvedValue(deposit("SETTLING"));
    const error = await settle(runDepositStep(freshRun(), signer, hooks())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DepositStillChecking);
    expect(service.getDeposit.mock.calls.length).toBeGreaterThan(1);
    expect(service.settleDeposit).toHaveBeenCalledTimes(1);
    const outcome = describeSubmittedDepositError(error);
    expect(outcome?.tone).toBe("warning");
    expect(outcome?.text).toMatch(/still checking/);
    expect(outcome?.text).not.toMatch(/timeout of/);
  });

  it("Try again on a SETTLING intent re-reads it and never settles the payload again", async () => {
    service.getDeposit.mockResolvedValueOnce(deposit("SETTLING")).mockResolvedValueOnce(deposit("SETTLED"));
    const result = await settle(
      runDepositStep(freshRun(), signer, { ...hooks(), previous: { kind: "signed", raw: RAW, depositId: "dep-1" } }),
    );
    expect(result).toMatchObject({ status: "SETTLED" });
    expect(service.settleDeposit).not.toHaveBeenCalled();
  });

  it("Try again on a CREATED intent hands the same signed bytes back once", async () => {
    service.getDeposit.mockResolvedValue(deposit("CREATED"));
    service.settleDeposit.mockResolvedValue({ id: "dep-1", status: "SETTLED", settledAmount: null, chainTxRef: "0xabc" });
    await settle(
      runDepositStep(freshRun(), signer, { ...hooks(), previous: { kind: "signed", raw: RAW, depositId: "dep-1" } }),
    );
    expect(service.settleDeposit).toHaveBeenCalledTimes(1);
    expect(service.settleDeposit).toHaveBeenCalledWith("dep-1", CHAIN, RAW);
    expect(evm.sendEvmDepositFor).not.toHaveBeenCalled();
  });

  it("a lost broadcast answer is re-read the same way, without reporting the hash again", async () => {
    evm.sendEvmDepositFor.mockResolvedValue({ kind: "broadcast", transactionHash: "0xhash" });
    service.settleDepositByBroadcast.mockRejectedValue(timeout());
    service.getDeposit.mockResolvedValue(deposit("SETTLED"));
    const result = await settle(runDepositStep(freshRun(), signer, hooks()));
    expect(result).toMatchObject({ status: "SETTLED" });
    expect(service.settleDepositByBroadcast).toHaveBeenCalledTimes(1);
  });
});

describe("POST /deposits with no answer", () => {
  it("is a friendly sentence, never the raw axios timeout", async () => {
    service.createDeposit.mockRejectedValue(timeout());
    const error = await settle(runDepositStep(freshRun(), signer, hooks())).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DepositNoAnswer);
    expect((error as Error).message).not.toMatch(/timeout of/);
    expect(describeMoneyError(error)).toBe((error as Error).message);
    expect(evm.sendEvmDepositFor).not.toHaveBeenCalled();
  });

  it("describeMoneyError never shows the raw timeout", () => {
    expect(describeMoneyError(timeout())).not.toMatch(/timeout of/);
  });
});
