// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CAPS,
  enablePaidState,
  parseEnablePaidCaps,
  type CapsDraft,
  type EnablePaidState,
} from "@/features/delegation/enable-paid";

import { EnablePaidView } from "./enable-paid-view";

/* A key the app proved while another was bound: the page approves the new one and names both. */
const OLD = "0x" + "1".repeat(32) + "1A2b9F3c";
const NEW = "0x" + "2".repeat(32) + "77AA88BB";
const NOW = Date.parse("2026-10-19T10:00:00.000Z");

function replacing(): Extract<EnablePaidState, { kind: "ready" }> {
  const state = enablePaidState({
    credentialId: "cred-1",
    fragmentKey: NEW,
    agents: [{ agentId: "agt-1", label: "research-bot" }],
    credentials: {
      "agt-1": [
        {
          id: "cred-1",
          agentId: "agt-1",
          name: "Key 1",
          issuedVia: "API_KEY",
          oauthClient: null,
          expiresAt: null,
          revokedAt: null,
          delegateAccount: `eip155:46630:${OLD}`,
          pendingDelegateAccount: `eip155:46630:${NEW}`,
          pendingDelegateRequestedAt: "2026-10-19T09:00:00.000Z",
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

function Harness({ run, onStopOldKey }: { run: () => Promise<undefined>; onStopOldKey?: (account: string) => void }) {
  const [draft, setDraft] = React.useState<CapsDraft>({ ...DEFAULT_CAPS });
  return (
    <EnablePaidView
      state={replacing()}
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
      isTopLevel={() => true}
      onStopOldKey={onStopOldKey}
    />
  );
}

afterEach(cleanup);

describe("EnablePaidView: replacing the payment key", () => {
  it("says it replaces the current key and shows both fingerprints", () => {
    render(<Harness run={async () => undefined} />);
    expect(screen.getByRole("heading", { name: /Replace the payment key for/ })).toBeTruthy();
    expect(screen.getByTestId("fingerprint").textContent).toBe("77AA 88BB");
    expect(screen.getByTestId("old-fingerprint").textContent).toBe("1A2B 9F3C");
    expect(screen.getByTestId("replacing-key").textContent).toContain("This new payment key replaces the current one, 1A2B 9F3C.");
    // The wallet signs for the new key only.
    expect(screen.getByTestId("will-sign").textContent).toContain(NEW);
    expect(screen.getByTestId("will-sign").textContent).not.toContain(OLD);
    expect(screen.queryByTestId("stop-old-key")).toBeNull();
  });

  it("after approval, offers to stop the old key through the Stop it flow", async () => {
    const onStop = vi.fn();
    render(<Harness run={async () => undefined} onStopOldKey={onStop} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "It matches what my app showed." }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    const offer = await screen.findByTestId("stop-old-key");
    expect(offer.textContent).toContain("1A2B 9F3C");
    fireEvent.click(screen.getByRole("button", { name: "Stop the old key" }));
    expect(onStop).toHaveBeenCalledWith(`eip155:46630:${OLD}`);
  });

  it("a declined approval offers nothing", async () => {
    render(
      <Harness
        run={async () => {
          throw new Error("declined");
        }}
        onStopOldKey={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "It matches what my app showed." }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });
    expect(screen.queryByTestId("stop-old-key")).toBeNull();
  });
});
