// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultEntry } from "@/features/toolsets/entry-rules";

vi.mock("@/services/catalogue.service", () => ({ getCatalogueProvider: vi.fn() }));
vi.mock("@/components/contracts/use-tool-versions", () => ({
  useToolVersions: () => ({ data: { versions: [] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useChainName", () => ({ useChainName: () => (id: string) => id }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { EntryRow } from "./toolset-editor";

function renderRow(takenDown?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ul>
        <EntryRow
          row={{ ...defaultEntry("gbp"), toolName: "e2eprv__gbp_rate" }}
          decimals={6}
          asset="eip155:46630/erc20:0xusdg"
          providers={[]}
          takenDown={takenDown}
          versions={[]}
          open={false}
          onToggle={vi.fn()}
          onApply={vi.fn()}
          onRange={vi.fn()}
          onRemove={vi.fn()}
          saving={false}
        />
      </ul>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("a tool set entry whose tool Assay took down (BUG-X-05)", () => {
  it("says Removed by Assay with a notice, not No provider yet", () => {
    renderRow(true);
    expect(screen.getByTestId("entry-taken-down").textContent).toBe("Removed by Assay");
    expect(screen.getByTestId("entry-taken-down-note").textContent).toMatch(/agents no longer see it/);
    expect(screen.queryByText("No provider yet")).toBeNull();
  });

  it("keeps No provider yet when the server sends no takenDown (older server) or false", () => {
    renderRow(undefined);
    expect(screen.getByText("No provider yet")).toBeTruthy();
    expect(screen.queryByTestId("entry-taken-down")).toBeNull();
    cleanup();
    renderRow(false);
    expect(screen.queryByTestId("entry-taken-down-note")).toBeNull();
  });
});
