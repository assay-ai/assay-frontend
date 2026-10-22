// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = vi.hoisted(() => ({ createCredential: vi.fn() }));
vi.mock("@/services/account.service", () => account);
vi.mock("./mcp-config-tabs", () => ({ McpConfigTabs: () => null }));

import { ApiError } from "@/libs/ApiClient";

import { CreateKeyForm } from "./create-key";

const DAY = 86_400_000;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CreateKeyForm agentId="agt-1" defaultName="Key 2" />
    </QueryClientProvider>,
  );
}

const sent = () => account.createCredential.mock.calls[0]![1] as { name: string; scopes: string[]; expiresAt: string };
const daysFromNow = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / DAY);
const create = () => fireEvent.click(screen.getByRole("button", { name: "Create key" }));

beforeEach(() => {
  account.createCredential.mockReset();
  account.createCredential.mockImplementation(async (_agent: string, body: { name: string; scopes: string[]; expiresAt: string }) => ({
    id: "k2",
    agentId: "agt-1",
    name: body.name,
    prefix: "assay_sk_live_ab12",
    token: "assay_sk_live_secret",
    scopes: body.scopes,
    expiresAt: body.expiresAt,
  }));
});
afterEach(cleanup);

describe("Create key: what it can do and when it ends", () => {
  it("defaults to Agent, no reports, 90 days", async () => {
    mount();
    expect((screen.getByRole("radio", { name: "Agent" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Can report bad results" }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("radio", { name: "90 days" }) as HTMLInputElement).checked).toBe(true);
    create();
    await waitFor(() => expect(account.createCredential).toHaveBeenCalledTimes(1));
    expect(account.createCredential.mock.calls[0]![0]).toBe("agt-1");
    expect(sent().name).toBe("Key 2");
    expect(sent().scopes).toEqual(["tools:call", "payments", "activity:read"]);
    expect(daysFromNow(sent().expiresAt)).toBe(90);
    expect(await screen.findByTestId("key-created")).toBeTruthy();
    expect(screen.getByTestId("key-created-expiry").textContent).toMatch(/^Expires /);
  });

  it("Free calls only, with reports, for 30 days", async () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Free calls only" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Can report bad results" }));
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    create();
    await waitFor(() => expect(account.createCredential).toHaveBeenCalledTimes(1));
    expect(sent().scopes).toEqual(["tools:call", "reports:write"]);
    expect(daysFromNow(sent().expiresAt)).toBe(30);
    expect((await screen.findByTestId("key-free-calls")).textContent).toBe("This key makes free calls only: it can never pay.");
  });

  it("Read only for a year: no reports box, and it says it cannot call tools", async () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: "Can report bad results" }));
    fireEvent.click(screen.getByRole("radio", { name: "Read only" }));
    expect(screen.queryByRole("checkbox", { name: "Can report bad results" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "1 year" }));
    create();
    await waitFor(() => expect(account.createCredential).toHaveBeenCalledTimes(1));
    expect(sent().scopes).toEqual(["activity:read"]);
    expect(daysFromNow(sent().expiresAt)).toBe(365);
    expect((await screen.findByTestId("key-free-calls")).textContent).toBe("This key cannot call tools: it reads its own activity only.");
  });

  it.each([
    ["ACCOUNT_CREDENTIAL_SCOPES_INVALID", "A key that pays must also be able to call tools. Pick another option."],
    ["ACCOUNT_CREDENTIAL_EXPIRY_INVALID", "The key must end within one year from now. Pick another expiry."],
  ])("%s reads in plain words", async (code, text) => {
    account.createCredential.mockRejectedValue(new ApiError(code, "server words", 400));
    mount();
    create();
    expect((await screen.findByTestId("create-key-error")).textContent).toBe(text);
    expect(document.body.textContent).not.toContain("server words");
  });
});
