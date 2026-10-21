// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/ui/sheet";
import type { Toolset } from "@/services/toolsets.service";

const service = vi.hoisted(() => ({ claimOrgHandle: vi.fn(), publishToolset: vi.fn(), rotateUnlistedToken: vi.fn(), unpublishToolset: vi.fn() }));
vi.mock("@/services/toolsets.service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { ShareBody } from "./share-dialog";
import { toolsetKeys } from "./use-toolsets";

const set = {
  id: "s1",
  slug: "tools-i-use",
  name: "Tools I use",
  description: null,
  category: "web",
  tags: [],
  icon: null,
  visibility: "PRIVATE",
  discovery: "AUTO",
  searchThreshold: 25,
  pinnedTools: [],
  mcpUrl: "https://mcp.example.com/my/tools-i-use",
  toolCount: 1,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  latestVersion: null,
  handle: null,
  entries: [],
} as unknown as Toolset;

function renderShare() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(toolsetKeys.handle, { handle: null, status: null, lockedAt: null, canChange: true });
  render(
    <QueryClientProvider client={client}>
      <Sheet open>
        <ShareBody set={set} onDone={vi.fn()} />
      </Sheet>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("sharing needs a public name: why, and the final URL first (D19)", () => {
  it("a link share explains the name and shows the link it will get, before anything is claimed", () => {
    renderShare();
    expect(screen.queryByTestId("share-url-preview")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Anyone with the link/ }));

    expect(screen.getByTestId("share-why-name").textContent).toContain("says who published it");
    const preview = screen.getByTestId("share-url-preview");
    expect(preview.textContent).toMatch(/\/u\/<private code>@1/);
    expect(preview.textContent).toContain("does not contain your public name");
    // The name is claimed only by this explicit button, which says so.
    expect(screen.getByTestId("share-primary").textContent).toBe("Claim the name and share v1");
    expect(service.claimOrgHandle).not.toHaveBeenCalled();
  });

  it("a catalogue share shows the URL with the name as it is typed", () => {
    renderShare();
    fireEvent.click(screen.getByRole("radio", { name: /Listed in the catalogue/ }));
    expect(screen.getByTestId("share-url-preview").textContent).toMatch(/\/@<your public name>\/tools-i-use@1/);

    fireEvent.change(document.getElementById("share-handle-input")!, { target: { value: "Acme" } });
    expect(screen.getByTestId("share-url-preview").textContent).toMatch(/\/@acme\/tools-i-use@1/);
    expect(service.claimOrgHandle).not.toHaveBeenCalled();
  });
});
