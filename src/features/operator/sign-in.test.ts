import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OperatorSignIn } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { personalSign } from "@/libs/chains/evm/operator-wallet";
import { getOperatorToken, OPERATOR_SESSION_KEY } from "@/libs/operator-session";
import { operatorApi } from "@/services/operator-api";
import { requestOperatorChallenge, verifyOperatorSignature } from "@/services/operator.service";

import { envelope, failure, memoryStorage, scriptedAdapter } from "./operator-test-kit";
import {
  NOT_AN_OPERATOR_MESSAGE,
  msUntilExpiry,
  sessionEndMessage,
  signInErrorMessage,
  signInWithWallet,
} from "./sign-in";

const ADDRESS = "0x52908400098527886E0F7030069857D2E4169EE7";

/** Byte-for-byte what the backend issues, trailing spaces and all. */
const MESSAGE = [
  "console.goassay.ai wants you to sign in with your Ethereum account:",
  ADDRESS,
  "",
  "Sign in to the Assay operator console",
  "",
  "URI: https://console.goassay.ai/operator",
  "Version: 1",
  "Chain ID: 46630",
  "Nonce: 8f2kQ1x9ZbT3",
  "Issued At: 2026-10-15T10:00:00.000Z",
  "Expiration Time: 2026-10-15T10:05:00.000Z",
].join("\n");

const SIGNATURE = `0x${"ab".repeat(65)}`;
const EXPIRES = "2026-10-15T18:00:00.000Z";

const operator: OperatorSignIn["operator"] = {
  id: "op-1",
  subject: "dan@",
  displayName: "Dan",
  walletAddress: ADDRESS.toLowerCase(),
  roles: ["ADJ"],
  authorityLimit: null,
  status: "ACTIVE",
};

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:30.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A mocked EIP-1193 wallet that records what it was asked to sign. */
function mockWallet() {
  const request = vi.fn(async (args: { method: string; params?: unknown[] }) => {
    if (args.method !== "personal_sign") throw new Error(`unexpected ${args.method}`);
    return SIGNATURE;
  });
  return { provider: { request }, request };
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return new TextDecoder().decode(bytes);
}

describe("signInWithWallet, with a mocked wallet and a scripted API", () => {
  it("signs the challenge message exactly, verifies that same message, and stores the session separately", async () => {
    storage.setItem("accessToken", "privy-buyer-token");
    const server = scriptedAdapter((call) => {
      if (call.url === "/operator/auth/challenge") {
        return [200, envelope({ message: MESSAGE, nonce: "8f2kQ1x9ZbT3", expiresAt: "2026-10-15T10:05:00.000Z" })];
      }
      if (call.url === "/operator/auth/verify") {
        return [200, envelope({ token: "op-session-token", expiresAt: EXPIRES, operator })];
      }
      return [404, failure("NOT_FOUND", 404)];
    });
    operatorApi.raw().defaults.adapter = server.adapter;
    const wallet = mockWallet();

    const session = await signInWithWallet(ADDRESS, {
      challenge: requestOperatorChallenge,
      sign: (message) => personalSign(wallet.provider, ADDRESS, message),
      verify: verifyOperatorSignature,
    });

    // The challenge names the wallet.
    expect(server.calls[0]).toMatchObject({ method: "POST", url: "/operator/auth/challenge", body: { address: ADDRESS } });

    // The wallet was asked to personal_sign exactly the issued bytes, for this address.
    expect(wallet.request).toHaveBeenCalledTimes(1);
    const [hexMessage, signer] = wallet.request.mock.calls[0][0].params as [string, string];
    expect(hexToUtf8(hexMessage)).toBe(MESSAGE);
    expect(signer).toBe(ADDRESS);

    // The verify carries the same message, untouched, and the signature.
    expect(server.calls[1]).toMatchObject({
      method: "POST",
      url: "/operator/auth/verify",
      body: { message: MESSAGE, signature: SIGNATURE },
    });

    // Stored under the operator key only; the buyer token is untouched.
    expect(session.token).toBe("op-session-token");
    expect(JSON.parse(storage.getItem(OPERATOR_SESSION_KEY) as string)).toEqual({
      token: "op-session-token",
      expiresAt: EXPIRES,
    });
    expect(storage.getItem("accessToken")).toBe("privy-buyer-token");
    expect(getOperatorToken()).toBe("op-session-token");
  });

  it("then sends the operator token, and only it, as the bearer on operator calls", async () => {
    storage.setItem("accessToken", "privy-buyer-token");
    storage.setItem(OPERATOR_SESSION_KEY, JSON.stringify({ token: "op-session-token", expiresAt: EXPIRES }));
    const server = scriptedAdapter(() => [200, envelope(operator)]);
    operatorApi.raw().defaults.adapter = server.adapter;

    await operatorApi.get("/operator/me");

    expect(server.calls[0].authorization).toBe("Bearer op-session-token");
  });

  it("stores nothing when the wallet declines", async () => {
    const wallet = {
      request: vi.fn(async () => {
        throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }),
    };
    const challenge = vi.fn(async () => ({ message: MESSAGE, nonce: "n", expiresAt: EXPIRES }));
    const verify = vi.fn();

    const failed = signInWithWallet(ADDRESS, {
      challenge,
      sign: (message) => personalSign(wallet, ADDRESS, message),
      verify,
    });
    await expect(failed).rejects.toMatchObject({ code: 4001 });
    expect(verify).not.toHaveBeenCalled();
    expect(storage.getItem(OPERATOR_SESSION_KEY)).toBeNull();
    expect(signInErrorMessage(await failed.catch((e: unknown) => e))).toMatch(/Nothing was signed/);
  });

  it("stores nothing when the verify is refused", async () => {
    const challenge = vi.fn(async () => ({ message: MESSAGE, nonce: "n", expiresAt: EXPIRES }));
    const verify = vi.fn(async () => {
      throw new ApiError("OPERATOR_NOT_AUTHORIZED", "not an operator", 403);
    });
    await expect(
      signInWithWallet(ADDRESS, { challenge, sign: async () => SIGNATURE, verify }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(storage.getItem(OPERATOR_SESSION_KEY)).toBeNull();
  });
});

describe("signInErrorMessage: the 401, 403 and 429 answers", () => {
  it("says a 403 OPERATOR_NOT_AUTHORIZED wallet is not an Assay operator", () => {
    const message = signInErrorMessage(new ApiError("OPERATOR_NOT_AUTHORIZED", "x", 403));
    expect(message).toContain(NOT_AN_OPERATOR_MESSAGE);
    expect(NOT_AN_OPERATOR_MESSAGE).toBe("This wallet is not an Assay operator.");
  });

  it("tells a rate-limited caller to wait", () => {
    expect(signInErrorMessage(new ApiError("OPERATOR_AUTH_RATE_LIMITED", "x", 429))).toMatch(/Wait/);
  });

  it("asks to try again on a refused signature (401)", () => {
    expect(signInErrorMessage(new ApiError("OPERATOR_CREDENTIAL_INVALID", "x", 401))).toMatch(
      /signature was not accepted.*Try again/,
    );
  });

  it("has words for a lost connection and anything else", () => {
    expect(signInErrorMessage(new ApiError("NETWORK_ERROR", "x", 0))).toMatch(/could not be reached/);
    expect(signInErrorMessage("weird")).toBe("Sign-in failed. Try again.");
  });
});

describe("the end of a session", () => {
  it("explains an expired or revoked session, and says nothing after a plain sign-out", () => {
    expect(sessionEndMessage("expired")).toMatch(/Sign in again/);
    expect(sessionEndMessage("signed-out")).toBeNull();
    expect(sessionEndMessage(null)).toBeNull();
  });

  it("counts down to the expiry, never below zero", () => {
    const now = Date.parse("2026-10-15T10:00:00.000Z");
    expect(msUntilExpiry("2026-10-15T18:00:00.000Z", now)).toBe(8 * 3600 * 1000);
    expect(msUntilExpiry("2026-10-15T09:00:00.000Z", now)).toBe(0);
    expect(msUntilExpiry("garbage", now)).toBe(0);
  });
});
