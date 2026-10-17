import { describe, expect, it, vi } from "vitest";

import type { Signer } from "@/hooks/useSigner";
import type { Eip155UnsignedTransaction } from "@/interfaces/chain-transaction";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { encodeCall } from "@/libs/chains/evm/calldata-fixtures";

import { connectedSpelling, sendSlashContractCall, signerMatches, signerRoleLabel } from "./send-contract-call";

const ARBITER = "0x2222222222222222222222222222222222222222";
const CHECKSUMMED = "0x18A508C9AF1c6fc512015276F6ca2E9aaBd74680";
const ID = `0x${"1".repeat(64)}` as const;
const DATA = encodeCall("upholdSlashBatch(bytes32[])", [[ID]]);
/** What the arbiter chose on the screen. */
const EXPECTED = { contract: "stake" as const, functionName: "upholdSlashBatch", args: [[ID]] };

const call = (overrides: Partial<SlashContractCall> = {}): SlashContractCall => ({
  chainId: "eip155:46630",
  to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c",
  data: DATA,
  value: "0",
  signer: ARBITER,
  signerRole: "ARBITER",
  functionName: "upholdSlashBatch",
  requestIds: [ID],
  ...overrides,
});

function signer(address: string) {
  const signAndSend = vi.fn(async (_tx: Eip155UnsignedTransaction) => `0x${"f".repeat(64)}`);
  return { signer: { address, signAndSend } as unknown as Signer, signAndSend };
}

const filled: Eip155UnsignedTransaction = {
  namespace: "eip155",
  chainId: "eip155:46630",
  kind: "transaction",
  from: ARBITER,
  to: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c",
  data: DATA,
  value: "0",
  nonce: "1",
  gasLimit: "100000",
  maxFeePerGas: "1",
  maxPriorityFeePerGas: "1",
};

describe("signerMatches", () => {
  it("matches the same address whatever its case", () => {
    expect(signerMatches(CHECKSUMMED.toLowerCase(), { signer: CHECKSUMMED })).toBe(true);
    expect(signerMatches(CHECKSUMMED, { signer: CHECKSUMMED.toLowerCase() })).toBe(true);
  });

  it("refuses another address, no wallet, and anything that is not an address", () => {
    expect(signerMatches(ARBITER, { signer: CHECKSUMMED })).toBe(false);
    expect(signerMatches(null, { signer: CHECKSUMMED })).toBe(false);
    expect(signerMatches("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", { signer: CHECKSUMMED })).toBe(false);
  });
});

describe("connectedSpelling", () => {
  it("returns the connected wallet's own spelling of the wanted address", () => {
    expect(connectedSpelling(["0xabc", CHECKSUMMED.toLowerCase()], CHECKSUMMED)).toBe(CHECKSUMMED.toLowerCase());
    expect(connectedSpelling([], CHECKSUMMED)).toBe(CHECKSUMMED);
  });
});

describe("signerRoleLabel", () => {
  it("names the roles a built call can have: the admin's only for the calls Contracts builds", () => {
    expect(signerRoleLabel("PROVIDER")).toMatch(/stake wallet/);
    expect(signerRoleLabel("ARBITER")).toBe("The arbiter");
    expect(signerRoleLabel("ADMIN")).toBe("The contracts' admin");
    expect(signerRoleLabel("OTHER")).toMatch(/Unknown/);
  });
});

describe("sendSlashContractCall", () => {
  it("fills, sends from the signer and waits for the receipt", async () => {
    const { signer: s, signAndSend } = signer(ARBITER);
    const fill = vi.fn(async () => filled);
    const wait = vi.fn(async () => undefined);
    await expect(sendSlashContractCall(call(), s, EXPECTED, { fill, wait })).resolves.toBe(`0x${"f".repeat(64)}`);
    expect(fill).toHaveBeenCalledWith({ chainId: "eip155:46630", from: ARBITER, to: call().to, data: DATA });
    expect(signAndSend).toHaveBeenCalledWith(filled);
    expect(wait).toHaveBeenCalledWith("eip155:46630", `0x${"f".repeat(64)}`, "upholdSlashBatch");
  });

  it("refuses, before the wallet is asked, a wallet that is not the signer", async () => {
    const { signer: s, signAndSend } = signer(CHECKSUMMED);
    const fill = vi.fn(async () => filled);
    await expect(sendSlashContractCall(call(), s, EXPECTED, { fill, wait: vi.fn() })).rejects.toThrow(/must be sent from/);
    expect(fill).not.toHaveBeenCalled();
    expect(signAndSend).not.toHaveBeenCalled();
  });

  it("names a known contract error the gas estimate reverts with, and sends nothing", async () => {
    const { signer: s, signAndSend } = signer(ARBITER);
    const revert = Object.assign(new Error("Execution reverted for an unknown reason."), {
      cause: { message: "execution reverted", data: "0x6a3f467f" /* SlashWindowNotDrained() */ },
    });
    const fill = vi.fn(async () => {
      throw revert;
    });
    await expect(sendSlashContractCall(call(), s, EXPECTED, { fill, wait: vi.fn() })).rejects.toThrow(
      /^The chain would refuse this upholdSlashBatch: Waiting until today's penalty limit has room; it will be paid in full\..*\(SlashWindowNotDrained\)\. Nothing was sent\.$/,
    );
    expect(signAndSend).not.toHaveBeenCalled();
  });

  it("passes an unknown estimate failure through unchanged", async () => {
    const { signer: s } = signer(ARBITER);
    const failure = new Error("nonce too low");
    await expect(
      sendSlashContractCall(call(), s, EXPECTED, {
        fill: vi.fn(async () => {
          throw failure;
        }),
        wait: vi.fn(),
      }),
    ).rejects.toBe(failure);
  });

  it("refuses a call that carries value", async () => {
    const { signer: s, signAndSend } = signer(ARBITER);
    await expect(
      sendSlashContractCall(call({ value: "1" }), s, EXPECTED, { fill: vi.fn(async () => filled), wait: vi.fn() }),
    ).rejects.toThrow(/takes no value/);
    expect(signAndSend).not.toHaveBeenCalled();
  });

  /*
    Frontend review 2026-10-15, F1 and operator review F1: `functionName` and
    `requestIds` are labels the server writes; `to` and `data` are what is
    signed. Each of these was sent before the calldata was decoded.
  */
  it("refuses an ERC-20 approve labelled as a dispute", async () => {
    const { signer: s, signAndSend } = signer(ARBITER);
    const ATTACKER = "0x000000000000000000000000000000000000dEaD";
    const approve = `0x095ea7b3${ATTACKER.slice(2).padStart(64, "0")}${"f".repeat(64)}`;
    const fill = vi.fn(async () => filled);
    for (const to of ["0x1111111111111111111111111111111111111111", "0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3"]) {
      await expect(
        sendSlashContractCall(call({ to, data: approve, functionName: "disputeSlashBatch" }), s, EXPECTED, {
          fill,
          wait: vi.fn(),
        }),
      ).rejects.toThrow(/SIGNING_REFUSED/);
    }
    expect(fill).not.toHaveBeenCalled();
    expect(signAndSend).not.toHaveBeenCalled();
  });

  it("refuses an uphold behind a cancel, other ids, or a block of another account", async () => {
    const { signer: s, signAndSend } = signer(ARBITER);
    const fill = vi.fn(async () => filled);
    const deps = { fill, wait: vi.fn() };
    const cancel = { ...EXPECTED, functionName: "cancelSlashBatch" };
    await expect(sendSlashContractCall(call({ functionName: "cancelSlashBatch" }), s, cancel, deps)).rejects.toThrow(
      /upholdSlashBatch, not cancelSlashBatch/,
    );
    await expect(
      sendSlashContractCall(call(), s, { ...EXPECTED, args: [[`0x${"2".repeat(64)}`]] }, deps),
    ).rejects.toThrow(/arguments/);
    const setBlocked = encodeCall("setBlocked(address,bool)", [CHECKSUMMED, true]);
    await expect(
      sendSlashContractCall(
        call({ to: "0xCf6592A3a053d9714D16d176A86fA039Fe7B6a43", data: setBlocked, functionName: "setBlocked" }),
        s,
        { contract: "config", functionName: "setBlocked", args: [ARBITER, true] },
        deps,
      ),
    ).rejects.toThrow(/arguments/);
    expect(signAndSend).not.toHaveBeenCalled();
  });
});
