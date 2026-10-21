// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevokeCredentialDialog, type RevokeKeyState } from "./revoke-credential-dialog";

afterEach(cleanup);

function setup(keyState: RevokeKeyState, tightenDelaySeconds: number | undefined, stop: () => Promise<unknown> = async () => undefined) {
  const props = {
    onRevoke: vi.fn(async () => undefined),
    onStopOnChain: vi.fn(stop),
    onDone: vi.fn(),
    onOpenChange: vi.fn(),
  };
  render(
    <RevokeCredentialDialog
      open
      name="Assay app on laptop-a"
      issuedVia="OAUTH"
      keyState={keyState}
      tightenDelaySeconds={tightenDelaySeconds}
      describeRevokeError={() => "revoke failed"}
      describeStopError={() => "Nothing was signed."}
      {...props}
    />,
  );
  return props;
}

const checkbox = () => screen.queryByRole("checkbox", { name: /Also stop its payment key on chain/ }) as HTMLInputElement | null;

describe("RevokeCredentialDialog", () => {
  it("no payment key: no checkbox, plain Revoke", () => {
    setup("none", 3600);
    expect(screen.getByText("Revoke Assay app on laptop-a?")).toBeTruthy();
    expect(checkbox()).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeTruthy();
  });

  it("active with a known delay: ticked, signs in the dialog after the revoke", async () => {
    const p = setup("active", 3600);
    expect(checkbox()!.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Revoke and sign" }));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith({ revoked: true, chain: "stopped" }, "active"));
    expect(p.onRevoke).toHaveBeenCalledTimes(1);
    expect(p.onStopOnChain).toHaveBeenCalledTimes(1);
    expect(p.onRevoke.mock.invocationCallOrder[0]!).toBeLessThan(p.onStopOnChain.mock.invocationCallOrder[0]!);
  });

  it.each([0, undefined])("active with the tighten delay %s: revokes, then hands off to the Stop it paying sheet", async (delay) => {
    const p = setup("active", delay);
    fireEvent.click(screen.getByRole("button", { name: "Revoke, then stop its key" }));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith({ revoked: true, chain: "handoff" }, "active"));
    expect(p.onStopOnChain).not.toHaveBeenCalled();
  });

  it("chain unread: the checkbox is offered, on, with the may-still-be-active note, and hands off", async () => {
    const p = setup("unknown", undefined);
    expect(checkbox()!.checked).toBe(true);
    expect(screen.getByTestId("revoke-may-be-active").textContent).toContain("may still be active");
    fireEvent.click(screen.getByRole("button", { name: "Revoke, then stop its key" }));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith({ revoked: true, chain: "handoff" }, "unknown"));
    expect(p.onStopOnChain).not.toHaveBeenCalled();
  });

  it("unticked: Revoke only, and says the key stays active", async () => {
    const p = setup("active", 3600);
    fireEvent.click(checkbox()!);
    expect(screen.getByText(/stays active on chain until you stop it/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith({ revoked: true, chain: "untouched" }, "active"));
  });

  it("a declined signature: the credential stays revoked, and the dialog says the key is still active", async () => {
    const p = setup("active", 3600, async () => {
      throw new Error("rejected");
    });
    fireEvent.click(screen.getByRole("button", { name: "Revoke and sign" }));
    await waitFor(() => expect(screen.getByTestId("revoke-still-active").textContent).toContain("Payment key still active on chain"));
    expect(p.onDone.mock.calls[0]![0]).toMatchObject({ revoked: true, chain: "failed" });
    expect(p.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Revoke and sign" })).toBeNull();
  });
});
