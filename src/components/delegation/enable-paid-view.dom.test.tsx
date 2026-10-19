// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CAPS,
  enablePaidState,
  parseEnablePaidCaps,
  type CapsDraft,
  type EnablePaidState,
} from "@/features/delegation/enable-paid";

import { EnablePaidView, FRAMED_TEXT, TICK_FIRST_TEXT } from "./enable-paid-view";

const KEY = "0x" + "1".repeat(32) + "1A2b9F3c";
const NOW = Date.parse("2026-10-19T10:00:00.000Z");

function ready(): Extract<EnablePaidState, { kind: "ready" }> {
  const state = enablePaidState({
    credentialId: "cred-1",
    fragmentKey: KEY,
    agents: [{ agentId: "agt-1", label: "research-bot" }],
    credentials: {
      "agt-1": [
        {
          id: "cred-1",
          agentId: "agt-1",
          name: "Assay app on laptop",
          issuedVia: "OAUTH",
          oauthClient: { name: "Assay app", paymentClient: true },
          expiresAt: null,
          revokedAt: null,
          delegateAccount: `eip155:46630:${KEY}`,
        },
      ],
    },
    delegates: [],
    nowMs: NOW,
    servesPaid: () => true,
  });
  if (state.kind !== "ready") throw new Error(state.text);
  return state;
}

function Harness({
  topLevel = true,
  run,
  ...overrides
}: { topLevel?: boolean; run: () => Promise<undefined> } & Partial<React.ComponentProps<typeof EnablePaidView>>) {
  const [draft, setDraft] = React.useState<CapsDraft>({ ...DEFAULT_CAPS });
  return (
    <EnablePaidView
      state={ready()}
      draft={draft}
      onDraftChange={setDraft}
      parsed={parseEnablePaidCaps(draft, 6)}
      chainName="Testnet"
      validUntil="2026-11-18T10:00:00.000Z"
      balance="$20.00"
      fundsShort={false}
      signatures={1}
      blocked={false}
      walletBlocker={null}
      steps={[{ id: "grant", label: "Let research-bot pay", cost: "free", run }]}
      describeError={() => "failed"}
      isTopLevel={() => topLevel}
      {...overrides}
    />
  );
}

const approve = () => screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
const tick = () => screen.getByRole("checkbox", { name: "It matches what my app showed." });

afterEach(cleanup);

describe("EnablePaidView", () => {
  it("Approve disabled until tick", async () => {
    const run = vi.fn(async () => undefined);
    render(<Harness run={run} />);
    expect(approve().disabled).toBe(true);
    expect(screen.getByText(TICK_FIRST_TEXT)).toBeTruthy();
    fireEvent.click(approve());
    expect(run).not.toHaveBeenCalled();

    fireEvent.click(tick());
    expect(approve().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(approve());
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("framed → disabled, even ticked", () => {
    const run = vi.fn(async () => undefined);
    render(<Harness run={run} topLevel={false} />);
    expect(screen.getAllByText(FRAMED_TEXT).length).toBeGreaterThan(0);
    fireEvent.click(tick());
    expect(approve().disabled).toBe(true);
    fireEvent.click(approve());
    expect(run).not.toHaveBeenCalled();
  });

  it("shows exactly what will be signed: key, caps, expiry, chain; and the bound", () => {
    render(<Harness run={vi.fn(async () => undefined)} />);
    const sign = screen.getByTestId("will-sign").textContent ?? "";
    expect(sign).toContain(KEY);
    expect(sign).toContain("$0.50 a call · $5 per 24 hours");
    expect(sign).toContain("Nov 18");
    expect(sign).toContain("Testnet (eip155:46630)");
    expect(screen.getByTestId("fingerprint").textContent).toBe("1A2B 9F3C");
    expect(screen.getByText("Check this matches what your app showed: 1A2B 9F3C")).toBeTruthy();
    expect(screen.getByTestId("wallet-copy").textContent).toBe(
      "In the wallet window, check the payment key ends with 1A2B9F3C and the limits are $0.50 a call and $5 per 24 hours.",
    );
    expect(screen.getByTestId("loss-bound").textContent).toMatch(/^Most this key can spend before it expires: \$155\./);
  });

  it("editing the caps updates the bound and the wallet copy; Standard is a preset", () => {
    render(<Harness run={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(screen.getByTestId("loss-bound").textContent).toMatch(/\$620\./);
    fireEvent.change(screen.getByRole("textbox", { name: "Days" }), { target: { value: "7" } });
    expect(screen.getByTestId("loss-bound").textContent).toMatch(/\$160\./);
    expect(screen.getByTestId("wallet-copy").textContent).toContain("$1 a call and $20 per 24 hours");
  });

  it("blocked, or a wallet that cannot sign: Approve stays off even ticked (m-9)", () => {
    const run = vi.fn(async () => undefined);
    render(<Harness run={run} blocked />);
    fireEvent.click(tick());
    expect(approve().disabled).toBe(true);
    expect(screen.getAllByText("Your account is blocked, so paid calls can't be turned on now.").length).toBeGreaterThan(0);
    cleanup();
    render(<Harness run={run} walletBlocker="Connect a wallet to sign." />);
    fireEvent.click(tick());
    expect(approve().disabled).toBe(true);
    expect(screen.getByText("Connect a wallet to sign.")).toBeTruthy();
  });

  it("clocks that disagree: no expiry, Approve off", () => {
    render(<Harness run={vi.fn(async () => undefined)} validUntil={null} expiryProblem="Clocks differ." />);
    fireEvent.click(tick());
    expect(approve().disabled).toBe(true);
    expect(screen.getByText("Clocks differ.")).toBeTruthy();
  });

  it("two signatures: the account ceiling it sets is shown, from the caps on the page", () => {
    render(
      <Harness
        run={vi.fn(async () => undefined)}
        signatures={2}
        currentCeiling={{ perCall: "0.25", perDay: "100" }}
      />,
    );
    expect(screen.getByTestId("ceiling-row").textContent).toBe("$0.50 a call · $5 per 24 hours");
    expect(screen.getByTestId("will-sign").textContent).toContain("raises your ceiling from $0.25 to $0.50 a call");
    expect(screen.getByTestId("will-sign").textContent).toContain("lowers");
    expect(screen.getByTestId("wallet-copy-ceiling").textContent).toBe(
      "The first wallet window sets your account ceiling to $0.50 a call and $5 per 24 hours.",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Per 24 hours" }), { target: { value: "7" } });
    expect(screen.getByTestId("ceiling-row").textContent).toBe("$0.50 a call · $7 per 24 hours");
  });

  it("a deposit still confirming on chain is shown apart from what paid calls can use (BUG-A-06)", () => {
    render(
      <Harness
        run={vi.fn(async () => undefined)}
        balance="$0.00"
        confirming="$20.00 still confirming on chain (usually within 30 minutes)"
      />,
    );
    expect(screen.getByTestId("funds-ready").textContent).toBe("Ready for paid calls: $0.00");
    expect(screen.getByTestId("funds-confirming").textContent).toBe(
      "$20.00 still confirming on chain (usually within 30 minutes). Paid calls can use it once the chain finalises it.",
    );
    expect(screen.queryByText(/Escrow balance/)).toBeNull();
  });

  it("nothing confirming: the escrow balance line as before", () => {
    render(<Harness run={vi.fn(async () => undefined)} />);
    expect(screen.getByText("Escrow balance: $20.00")).toBeTruthy();
    expect(screen.queryByTestId("funds-confirming")).toBeNull();
  });

  it("one signature: no ceiling row", () => {
    render(<Harness run={vi.fn(async () => undefined)} />);
    expect(screen.queryByTestId("ceiling-row")).toBeNull();
  });

  it("Add funds is a link to the Funding page when the deposit cannot run here", () => {
    render(<Harness run={vi.fn(async () => undefined)} fundsShort addFunds={{ kind: "link", href: "/funding" }} />);
    expect(screen.getByRole("link", { name: "Add funds on the Funding page" }).getAttribute("href")).toBe("/funding");
  });

  it("the page takes nothing from the URL but the credential id and the #key (I-5)", () => {
    const page = readFileSync(resolve(__dirname, "../../app/(main)/agents/enable-paid/page.tsx"), "utf8");
    const reads = [...page.matchAll(/useSearchParam\(\s*([^)]*)\)/g)].map((m) => m[1]);
    expect(reads).toEqual(['"credential"']);
    expect(page).not.toMatch(/useSearchParams|URLSearchParams|searchParams|location\.(search|hash|href)|window\.location/);
    // The form's first values come from the API state only.
    expect(page).toMatch(/setDraft\(initialDraft\(state\)\)/);
  });

  it("the page signs only what enablePaidPlan built from what it shows (R1-I1)", () => {
    const page = readFileSync(resolve(__dirname, "../../app/(main)/agents/enable-paid/page.tsx"), "utf8");
    // One plan, from the form and this device's clock; the server time only refuses.
    expect(page).toMatch(/enablePaidPlan\(\{\s*parsed,\s*serverTime: escrow\?\.serverTime,\s*receivedAtMs: money\.escrowQuery\.dataUpdatedAt,\s*localNowMs: nowMs,\s*\}\)/);
    // The steps come from the plan only: its ceiling and its expiry, both required by type.
    // The whole call: nothing beside the plan can carry a ceiling, caps or expiry.
    expect(page).toMatch(
      /enablePaidSteps\(\{\s*money,\s*queryClient,\s*agentName: state\.agentLabel,\s*delegateAccount: state\.delegateAccount,\s*form: \{[^}]*\},\s*openingCaps,\s*plan,\s*\}\)/,
    );
    expect(page).not.toMatch(/agentPaySteps|serverNowSeconds|pageExpiry|nowSeconds/);
    // The view shows the same expiry, and its refusal.
    expect(page).toMatch(/validUntil=\{plan\.ok \? plan\.validUntil : null\}/);
    expect(page).toMatch(/expiryProblem=\{plan\.ok \? null : plan\.problem\}/);
    expect(page).toMatch(/boundDays=\{plan\.ok \? plan\.boundDays : null\}/);
  });

  it("the Funding link carries the credential id only, never the key", () => {
    const page = readFileSync(resolve(__dirname, "../../app/(main)/agents/enable-paid/page.tsx"), "utf8");
    expect(page).toMatch(/const returnHref = enablePaidReturnHref\(credentialId\);/);
    expect(page).toMatch(/returnTo=\$\{encodeURIComponent\(returnHref\)\}/);
    // The sign-in round trip comes back the same way: the credential id, never the key.
    expect(page).not.toMatch(/thisPageHref|location\.hash/);
    expect(page).toMatch(/loginHref\(\{ next: \(credentialId && enablePaidReturnHref\(credentialId\)\) \|\| "\/agents\/enable-paid" \}\)/);
  });

  it("the route files import no analytics", () => {
    for (const file of ["../../app/(main)/agents/enable-paid/page.tsx", "./enable-paid-view.tsx"]) {
      const imports = readFileSync(resolve(__dirname, file), "utf8").match(/^import[^;]+;/gm) ?? [];
      expect(imports.length).toBeGreaterThan(0);
      for (const line of imports) {
        expect(line).not.toMatch(/analytics|gtag|posthog|segment|mixpanel|amplitude|plausible|sentry|datadog|hotjar/i);
      }
    }
  });
});
