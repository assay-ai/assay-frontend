// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorSessionContext } from "@/features/operator/session-context";
import type { OperatorDirectoryEntry, OperatorIdentity } from "@/interfaces/operator";

/*
  D25 on Team's "Add someone": no limit is preselected, sending without one
  is refused on the form, and the hint says what $0 rules out for the role.
*/

const service = vi.hoisted(() => ({
  listOperators: vi.fn(),
  listApprovals: vi.fn(),
  addOperator: vi.fn(),
  changeOperator: vi.fn(),
  removeOperator: vi.fn(),
}));
vi.mock("@/services/operator.service", () => service);
const params = vi.hoisted(() => new URLSearchParams("new=1"));
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/operator/operators",
}));

import TeamPage from "./page";

const USD = { asset: "eip155:46630/erc20:0x0000000000000000000000000000000000000001", decimals: 6 };
const ME: OperatorIdentity = { id: "op-me", subject: "me@", displayName: "Me Admin", walletAddress: "0x1111111111111111111111111111111111111111", roles: ["OPS_ADMIN"], authorityLimit: { amount: "0", ...USD }, status: "ACTIVE" };
const OTHER_ADMIN = { ...ME, id: "op-2", subject: "two@", displayName: "Second Admin", walletAddress: "0x2222222222222222222222222222222222222222", lastSeenAt: null } as unknown as OperatorDirectoryEntry;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPage() {
  service.listOperators.mockResolvedValue({ items: [{ ...ME, lastSeenAt: null }, OTHER_ADMIN], pageInfo: { nextCursor: null, hasMore: false } });
  service.listApprovals.mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasMore: false } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OperatorSessionContext.Provider value={ME}>
        <TeamPage />
      </OperatorSessionContext.Provider>
    </QueryClientProvider>,
  );
}

describe("adding an operator: the authority limit (D25)", () => {
  it("preselects no limit, refuses to send without one, and says what $0 rules out", async () => {
    renderPage();
    const limits = await screen.findByRole("radiogroup", { name: "Authority limit" });
    expect(within(limits).queryAllByRole("radio", { checked: true })).toHaveLength(0);

    fireEvent.click(screen.getByRole("radio", { name: /^Adjudicator/ }));
    expect(screen.getByText(/At \$0 they can't suspend a penalty or uphold a buyer's call-dispute refund, nor approve one\./)).toBeTruthy();
    // Still nothing chosen after picking a role.
    expect(within(screen.getByRole("radiogroup", { name: "Authority limit" })).queryAllByRole("radio", { checked: true })).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Riley Brooks" } });
    fireEvent.change(screen.getByLabelText("Their wallet"), { target: { value: "0x3333333333333333333333333333333333333333" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Send for approval" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Send for approval" }));
    expect(await screen.findByText(/Choose a limit\./)).toBeTruthy();
    expect(service.addOperator).not.toHaveBeenCalled();
  });
});
