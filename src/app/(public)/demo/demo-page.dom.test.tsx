// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const service = vi.hoisted(() => ({ getDemoStatus: vi.fn() }));
vi.mock("@/services/demo.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/demo.service")>()),
  getDemoStatus: service.getDemoStatus,
}));

import DemoPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* A (2026-10-18): with the demo off, /demo was a dead end ("not running on this site"). */
describe("/demo", () => {
  it("goes to How it works when the deployment runs no demo", async () => {
    service.getDemoStatus.mockResolvedValue({ configured: false, compensation: null });
    render(<DemoPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/how-it-works"));
    expect(screen.queryByText("The live demo is not running on this site")).toBeNull();
  });

  it("stays and says so when the status cannot be read", async () => {
    service.getDemoStatus.mockRejectedValue(new Error("offline"));
    render(<DemoPage />);
    await screen.findByText("The live demo is not running on this site");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("runs where the demo is configured", async () => {
    service.getDemoStatus.mockResolvedValue({ configured: true, compensation: null });
    render(<DemoPage />);
    await screen.findByText("Make it refuse to charge you.");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
