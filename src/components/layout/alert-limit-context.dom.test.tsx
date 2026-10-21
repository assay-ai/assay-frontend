// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listAgents: vi.fn(async (_query: unknown) => ({ items: [{ agentId: "a-1" }] })) }));

vi.mock("@/services/account.service", () => ({ listAgents: api.listAgents, markNotificationRead: vi.fn() }));
vi.mock("@/services/limits.service", () => ({ getSpendPolicyTyped: vi.fn(async () => null) }));

import { useAlertLimitContext } from "./alert-entry";

function Probe() {
  useAlertLimitContext();
  return null;
}

afterEach(cleanup);

describe("the bell's limit context", () => {
  it("reads the plain agents list (shared with the entity names), never the keys and their health", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.listAgents).toHaveBeenCalledTimes(1));
    expect(api.listAgents).toHaveBeenCalledWith({ limit: 50 });
    expect(client.getQueryData(["agents"])).toEqual({ items: [{ agentId: "a-1" }] });
  });
});
