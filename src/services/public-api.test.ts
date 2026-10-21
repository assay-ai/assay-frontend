import { afterEach, describe, expect, it, vi } from "vitest";

import { envelope, memoryStorage, scriptedAdapter } from "@/features/operator/operator-test-kit";

import { publicApi } from "./public-api";
import { api } from "./api";

/**
 * The `/public/*` reads go out without a token, even for a signed-in visitor:
 * a request with `Authorization` is never cached at the edge.
 */
describe("publicApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends no Authorization header while the shared client sends the session token", async () => {
    const storage = memoryStorage();
    storage.setItem("accessToken", "session-token");
    vi.stubGlobal("window", { localStorage: storage });

    const { adapter, calls } = scriptedAdapter(() => [200, envelope({ tools: [] })]);
    publicApi.raw().defaults.adapter = adapter;
    api.raw().defaults.adapter = adapter;

    await publicApi.get("/public/catalogue/tools");
    await api.get("/agents/me");

    expect(calls.map((call) => call.authorization)).toEqual([undefined, "Bearer session-token"]);
  });
});
