import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { envelope, failure, memoryStorage, scriptedAdapter } from "@/features/operator/operator-test-kit";
import { ApiError } from "@/libs/ApiClient";
import {
  clearOperatorSession,
  getOperatorToken,
  OPERATOR_SESSION_KEY,
  readOperatorSession,
  saveOperatorSession,
  subscribeOperatorSession,
} from "@/libs/operator-session";

import { operatorApi } from "./operator-api";
import { logoutOperator, requestOperatorChallenge, verifyOperatorSignature } from "./operator.service";

const FUTURE = "2026-10-15T18:00:00.000Z";
let storage: ReturnType<typeof memoryStorage>;
let ends: (string | null)[];
let unsubscribe: () => void;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00.000Z"));
  ends = [];
  unsubscribe = subscribeOperatorSession((end) => ends.push(end));
});

afterEach(() => {
  unsubscribe();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the operator session store", () => {
  it("keeps {token, expiresAt} under its own key, apart from the buyer accessToken", () => {
    storage.setItem("accessToken", "buyer");
    saveOperatorSession({ token: "op", expiresAt: FUTURE });
    expect(storage.dump()).toEqual({
      accessToken: "buyer",
      [OPERATOR_SESSION_KEY]: JSON.stringify({ token: "op", expiresAt: FUTURE }),
    });
    clearOperatorSession();
    expect(storage.dump()).toEqual({ accessToken: "buyer" });
  });

  it("treats an expired session as none, and removes it", () => {
    saveOperatorSession({ token: "op", expiresAt: "2026-10-15T09:59:59.000Z" });
    expect(getOperatorToken()).toBeNull();
    expect(storage.getItem(OPERATOR_SESSION_KEY)).toBeNull();
  });

  it("drops the old pasted-token key and an unreadable record", () => {
    storage.setItem("operatorAccessToken", "pasted");
    storage.setItem(OPERATOR_SESSION_KEY, "{not json");
    expect(readOperatorSession()).toBeNull();
    expect(storage.dump()).toEqual({});
  });

  it("tells subscribers when a session starts and why it ended", () => {
    saveOperatorSession({ token: "op", expiresAt: FUTURE });
    clearOperatorSession("expired");
    expect(ends).toEqual([null, "expired"]);
  });
});

describe("a 401 on an operator call", () => {
  beforeEach(() => {
    saveOperatorSession({ token: "op", expiresAt: FUTURE });
    ends = [];
  });

  it("ends the session and sends the console back to sign-in, whichever call it was", async () => {
    storage.setItem("accessToken", "buyer");
    operatorApi.raw().defaults.adapter = scriptedAdapter(() => [
      401,
      failure("OPERATOR_CREDENTIAL_INVALID", 401),
    ]).adapter;

    await expect(operatorApi.get("/operator/cases/abc")).rejects.toMatchObject({ status: 401 });
    expect(getOperatorToken()).toBeNull();
    expect(ends).toEqual(["expired"]);
    // The buyer's session is not the operator's to end.
    expect(storage.getItem("accessToken")).toBe("buyer");
  });

  it("does not end anything on a refused sign-in: that is the sign-in screen's to report", async () => {
    operatorApi.raw().defaults.adapter = scriptedAdapter(() => [
      401,
      failure("OPERATOR_CREDENTIAL_INVALID", 401),
    ]).adapter;
    await expect(verifyOperatorSignature({ message: "m", signature: "0x00" })).rejects.toBeInstanceOf(ApiError);
    expect(ends).toEqual([]);
    expect(getOperatorToken()).toBe("op");
  });

  it("leaves the session alone on a 403 and a 429", async () => {
    operatorApi.raw().defaults.adapter = scriptedAdapter((call) =>
      call.url.includes("challenge")
        ? [429, failure("OPERATOR_AUTH_RATE_LIMITED", 429)]
        : [403, failure("OPERATOR_NOT_AUTHORIZED", 403)],
    ).adapter;
    await expect(requestOperatorChallenge("0x0")).rejects.toMatchObject({ status: 429, code: "OPERATOR_AUTH_RATE_LIMITED" });
    await expect(operatorApi.get("/operator/me")).rejects.toMatchObject({ status: 403, code: "OPERATOR_NOT_AUTHORIZED" });
    expect(ends).toEqual([]);
    expect(getOperatorToken()).toBe("op");
  });
});

describe("logout", () => {
  it("revokes the session with its own bearer token", async () => {
    saveOperatorSession({ token: "op", expiresAt: FUTURE });
    const server = scriptedAdapter(() => [204, ""]);
    operatorApi.raw().defaults.adapter = server.adapter;
    await logoutOperator();
    expect(server.calls[0]).toMatchObject({
      method: "POST",
      url: "/operator/auth/logout",
      authorization: "Bearer op",
    });
  });

  it("is answered by the envelope like every other route", async () => {
    operatorApi.raw().defaults.adapter = scriptedAdapter(() => [200, envelope({ message: "m", nonce: "n", expiresAt: FUTURE })]).adapter;
    await expect(requestOperatorChallenge("0xabc")).resolves.toEqual({ message: "m", nonce: "n", expiresAt: FUTURE });
  });
});
