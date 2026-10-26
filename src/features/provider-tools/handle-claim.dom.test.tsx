// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/provider/apis/new", useSearchParams: () => new URLSearchParams() }));
const claimOrgHandle = vi.hoisted(() => vi.fn());
vi.mock("@/services/toolsets.service", async (original) => ({ ...(await original<object>()), claimOrgHandle }));

import { HandleClaim } from "./name-step";

afterEach(() => cleanup());

/* Onboarding wave item 4: the public name is checked as it is typed, by the server's rule. */
describe("HandleClaim", () => {
  function mount() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HandleClaim />
      </QueryClientProvider>,
    );
    return { input: screen.getByRole("textbox", { name: /Public name/ }) as HTMLInputElement, claim: () => screen.getByRole("button", { name: "Claim" }) as HTMLButtonElement };
  }

  it("refuses 1abc before any request, with the rule, and keeps Claim off", () => {
    const { input, claim } = mount();
    fireEvent.change(input, { target: { value: "1abc" } });
    expect(screen.getByText("Use 3–24 lowercase letters, digits or “-”, starting with a letter.")).toBeTruthy();
    expect(claim().disabled).toBe(true);
    fireEvent.click(claim());
    expect(claimOrgHandle).not.toHaveBeenCalled();
  });

  it("turns Claim on for a name the server would take", () => {
    const { input, claim } = mount();
    fireEvent.change(input, { target: { value: "acme-labs" } });
    expect(claim().disabled).toBe(false);
  });
});
