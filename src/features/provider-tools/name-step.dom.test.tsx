// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/provider/apis/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: false, authenticated: false }) }));
const listPublicCategories = vi.hoisted(() => vi.fn());
vi.mock("@/services/public-toolsets.service", async (original) => ({ ...(await original<object>()), listPublicCategories }));
vi.mock("@/services/provider-tools.service", async (original) => ({ ...(await original<object>()), listProviderTools: async () => ({ items: [] }) }));

import { toolsetKeys } from "@/components/toolsets/use-toolsets";

import { NameStep } from "./name-step";

afterEach(() => cleanup());

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(toolsetKeys.handle, { handle: "acme", status: "ACTIVE", lockedAt: null, canChange: true });
  render(
    <QueryClientProvider client={client}>
      <NameStep tool={null} onContinue={() => undefined} />
    </QueryClientProvider>,
  );
}

/* Onboarding wave 3: the topic is a required choice from the catalogue's, never a misleading "social" placeholder. */
describe("NameStep topic", () => {
  it("asks for one of the catalogue's topics when there is no neutral one", async () => {
    listPublicCategories.mockResolvedValue({ categories: [{ category: "weather", tools: 1, toolsets: 0 }, { category: "finance", tools: 1, toolsets: 0 }] });
    mount();
    const select = (await screen.findByTestId("topic-select")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose a topic", "finance", "weather"]);
    expect(select.value).toBe("");
    expect(select.required).toBe(true);
    expect(document.body.textContent).not.toMatch(/social/);
  });

  it("defaults to a neutral topic when the catalogue has one", async () => {
    listPublicCategories.mockResolvedValue({ categories: [{ category: "weather", tools: 1, toolsets: 0 }, { category: "other", tools: 1, toolsets: 0 }] });
    mount();
    const select = (await screen.findByTestId("topic-select")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("other"));
  });
});
