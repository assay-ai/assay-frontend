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
vi.mock("@/libs/chains/solana/deposit-transaction", () => ({
  buildDepositTransaction: vi.fn(async () => ({ transactionBytes: new Uint8Array([1, 2, 3]) })),
}));

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

describe("the wallet is warmed before the intent clock starts (BUG-PROD-DEPOSIT-01)", () => {
  it("creates the intent only after a slow wallet warm-up resolved", async () => {
    const order: string[] = [];
    let release!: () => void;
    const slow = {
      ...signer,
      prepare: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            release = () => {
              order.push("wallet ready");
              resolve();
            };
          }),
      ),
    } as unknown as Signer;
    service.createDeposit.mockImplementation(async () => {
      order.push("POST /deposits");
      return { depositId: "dep-1", expiresAt: "", requirements: { namespace: "eip155", chainId: CHAIN } };
    });
    service.settleDeposit.mockResolvedValue({ id: "dep-1", status: "SETTLED", settledAmount: null, chainTxRef: null });
    const step = runDepositStep(freshRun(), slow, hooks());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(service.createDeposit).not.toHaveBeenCalled();
    release();
    await step;
    expect(order).toEqual(["wallet ready", "POST /deposits"]);
  });

  it("does not hold the click for ever: the intent is created after the warm-up limit", async () => {
    const stuck = { ...signer, prepare: vi.fn(() => new Promise<void>(() => undefined)) } as unknown as Signer;
    service.settleDeposit.mockResolvedValue({ id: "dep-1", status: "SETTLED", settledAmount: null, chainTxRef: null });
    const step = runDepositStep(freshRun(), stuck, hooks());
    await vi.advanceTimersByTimeAsync(30_000);
    await step;
    expect(service.createDeposit).toHaveBeenCalledTimes(1);
  });

  it("Try again with a fresh intent reuses it: no second warm-up, no second POST /deposits", async () => {
    const prepared = { ...signer, prepare: vi.fn(async () => undefined) } as unknown as Signer;
    service.settleDeposit.mockRejectedValueOnce(new ApiError("PAYMENT_SETTLEMENT_FAILED", "x", 502));
    service.settleDeposit.mockResolvedValue({ id: "dep-1", status: "SETTLED", settledAmount: null, chainTxRef: null });
    const run = freshRun();
    await expect(runDepositStep(run, prepared, hooks())).rejects.toBeInstanceOf(ApiError);
    await runDepositStep(run, prepared, hooks());
    expect(service.createDeposit).toHaveBeenCalledTimes(1);
    expect(prepared.prepare).toHaveBeenCalledTimes(1);
  });
});

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const HASH = "0xhash" as `0x${string}`;

describe("Solana: a lost settle answer never leads to a second signed transfer (review I1)", () => {
  const solanaSigner = () =>
    ({
      address: "BuyerSol",
      kind: "embedded",
      chainId: SOLANA,
      signTransaction: vi.fn(async () => ({ namespace: "solana", chainId: SOLANA, transactionBase64: "AQID" })),
    }) as unknown as Signer & { signTransaction: ReturnType<typeof vi.fn> };
  const solanaRun = (): DepositRun => ({ chainId: SOLANA, amountAtomic: "5000000", created: null, createdAt: 0 });

  beforeEach(() => {
    service.createDeposit.mockResolvedValue({
      depositId: "dep-1",
      expiresAt: "",
      requirements: {
        namespace: "solana",
        chainId: SOLANA,
        payTo: "Ata",
        asset: "Mint",
        amount: "5000000",
        decimals: 6,
        feePayer: "Fee",
        memo: "dep-1",
        blockhash: "Hash",
        lastValidBlockHeight: "100",
      },
    });
  });

  it("reports the signed payload, so Try again re-reads the intent instead of signing again", async () => {
    const wallet = solanaSigner();
    const run = solanaRun();
    const first = hooks();
    service.settleDeposit.mockRejectedValue(timeout());
    service.getDeposit.mockResolvedValue(deposit("SETTLING"));
    const error = await settle(runDepositStep(run, wallet, first)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DepositStillChecking);
    expect(first.onSigned).toHaveBeenCalledWith({ kind: "signed", raw: "AQID", depositId: "dep-1" });

    // Past INTENT_FRESH_MS: without the reported payload this minted a new intent and signed a second transfer.
    vi.setSystemTime(Date.now() + 120_000);
    service.getDeposit.mockReset().mockResolvedValue(deposit("SETTLED"));
    const previous = first.onSigned.mock.calls[0]![0];
    const result = await settle(runDepositStep(run, wallet, { ...hooks(), previous }));
    expect(result).toMatchObject({ status: "SETTLED" });
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(service.createDeposit).toHaveBeenCalledTimes(1);
    expect(service.settleDeposit).toHaveBeenCalledTimes(1);
  });

  it("signs afresh only for an EXPIRED intent, whose payload never reached the chain", async () => {
    const wallet = solanaSigner();
    service.getDeposit.mockResolvedValue(deposit("EXPIRED"));
    service.settleDeposit.mockResolvedValue({ id: "dep-1", status: "SETTLED", settledAmount: null, chainTxRef: "sig" });
    const run = solanaRun();
    run.created = await service.createDeposit();
    run.createdAt = Date.now();
    await settle(
      runDepositStep(run, wallet, { ...hooks(), previous: { kind: "signed", raw: "AQID", depositId: "dep-1" } }),
    );
    expect(wallet.signTransaction).toHaveBeenCalledTimes(1);
    expect(service.createDeposit).toHaveBeenCalledTimes(2);
  });
});
