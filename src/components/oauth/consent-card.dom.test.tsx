// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsentRequest } from "@/features/oauth/consent";
import { ACTIVATION_DELAY_MS } from "@/features/oauth/frame-guard";
import { RID_STORAGE_KEY, forgetRequestId, takeRequestId } from "@/features/oauth/request-id";
import { ApiError } from "@/libs/ApiClient";

import { ConsentCard } from "./consent-card";
import { ConsentSetLimitsControl, type LimitsSheetProps } from "./consent-set-limits";

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x0", decimals: 6 });
const NOW = new Date("2026-10-19T10:00:12.000Z");
const RID = "A".repeat(43);

function request(overrides: Partial<ConsentRequest> = {}): ConsentRequest {
  const agent = (id: string, label: string) => ({
    id,
    label,
    active: true,
    limits: { perCall: usd("500000"), perDay: usd("5000000"), freeCallsPerDay: 100 },
    access: { mode: "ALL" as const, summary: "All tools" },
    liveOAuthCredentials: 0,
  });
  return {
    requestId: "r",
    createdAt: "2026-10-19T10:00:00.000Z",
    expiresAt: "2026-10-19T10:10:00.000Z",
    client: {
      name: "Claude Code",
      kind: "CIMD",
      registrableDomain: "claude.ai",
      host: "claude.ai",
      verified: true,
      builtin: false,
      paymentClient: false,
    },
    returnTo: { kind: "WEB", display: "claude.ai" },
    scope: ["assay:agent"],
    agents: [agent("agt-1", "research-bot"), agent("agt-2", "ops-bot")],
    replaces: { id: "c-old", name: "Assay app on this Mac", agentId: "agt-2", narrowed: true, live: true },
    suggestedName: "Claude Code · 2026-10-19",
    ...overrides,
  };
}

function mount(props: Partial<React.ComponentProps<typeof ConsentCard>> = {}) {
  const onApprove = vi.fn().mockResolvedValue(undefined);
  const onDeny = vi.fn().mockResolvedValue(undefined);
  render(
    <ConsentCard
      request={request()}
      now={NOW}
      signedInAs="person@example.com"
      onSignOut={() => undefined}
      onApprove={onApprove}
      onDeny={onDeny}
      fetchedAt={Date.parse("2026-10-19T10:00:00.000Z")}
      {...props}
    />,
  );
  return { onApprove: (props.onApprove as typeof onApprove) ?? onApprove, onDeny };
}

const approve = () => screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
const cancel = () => screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;

/** A click as a person makes it: the press, then the click. */
function press(element: HTMLElement) {
  fireEvent.pointerDown(element);
  fireEvent.click(element);
}

/** Past the delay, then a fresh pointer movement. */
function arm() {
  act(() => {
    vi.advanceTimersByTime(ACTIVATION_DELAY_MS);
  });
  act(() => {
    fireEvent.pointerMove(window);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConsentCard click guards", () => {
  it("buttons disabled when window.top !== window.self", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
    mount();
    arm();
    expect(approve().disabled).toBe(true);
    expect(cancel().disabled).toBe(true);
    expect(screen.getByText("This page is shown inside another page, so its buttons are off.")).toBeTruthy();
  });

  it("disabled for 500 ms after visible, then only after a fresh pointer event", () => {
    mount();
    expect(document.visibilityState).toBe("visible");
    // A pointer event before the delay is over does not count.
    act(() => {
      fireEvent.pointerMove(window);
      vi.advanceTimersByTime(ACTIVATION_DELAY_MS - 1);
    });
    expect(approve().disabled).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(approve().disabled).toBe(true);
    act(() => {
      fireEvent.pointerMove(window);
    });
    expect(approve().disabled).toBe(false);
    expect(cancel().disabled).toBe(false);
  });

  it("hiding the page disarms the buttons and starts the delay again", () => {
    mount();
    arm();
    expect(approve().disabled).toBe(false);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(approve().disabled).toBe(true);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      fireEvent.pointerMove(window);
    });
    expect(approve().disabled).toBe(true);
    arm();
    expect(approve().disabled).toBe(false);
  });

  it("never approves by itself", () => {
    const { onApprove, onDeny } = mount();
    arm();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onApprove).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });
});

describe("I1: only an interaction that starts after arming acts", () => {
  it("after the delay, the press that arms the buttons does not approve; the next one does", async () => {
    const { onApprove } = mount();
    act(() => {
      vi.advanceTimersByTime(ACTIVATION_DELAY_MS);
    });
    // One gesture: its pointerdown arms the buttons (and the browser re-renders
    // before pointerup, as React does for a discrete event), its click must not act.
    act(() => {
      fireEvent.pointerDown(approve());
    });
    expect(approve().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(approve());
    });
    expect(onApprove).not.toHaveBeenCalled();
    await act(async () => {
      press(approve());
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("a press that began before arming does not approve when its click lands after", async () => {
    const { onApprove } = mount();
    act(() => {
      vi.advanceTimersByTime(ACTIVATION_DELAY_MS);
    });
    // Hidden: the buttons disarm. A press starts while they are off, the page
    // shows again, the delay passes, the pointer moves (arming), then the old
    // press's click lands.
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      fireEvent.pointerDown(approve()); // starts while disarmed
    });
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(ACTIVATION_DELAY_MS);
    });
    act(() => {
      fireEvent.pointerMove(window); // arms
    });
    expect(approve().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(approve()); // the old press's click
    });
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("a key press after arming acts (keyboard users)", async () => {
    const { onApprove } = mount();
    arm();
    await act(async () => {
      fireEvent.keyDown(approve(), { key: "Enter" });
      fireEvent.click(approve());
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("a double click right after arming approves at most once", async () => {
    const onApprove = vi.fn(() => new Promise<void>(() => undefined));
    mount({ onApprove });
    arm();
    await act(async () => {
      press(approve());
      press(approve());
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});

describe("ConsentCard decisions", () => {
  it("approves as the pre-selected agent with the name on the card", async () => {
    const { onApprove } = mount();
    arm();
    await act(async () => {
      press(approve());
    });
    expect(onApprove).toHaveBeenCalledWith({ agentId: "agt-2", name: "Claude Code · 2026-10-19" });
  });

  it("picking another agent than the replaced one warns that the old one stays", () => {
    mount();
    expect(screen.getByTestId("consent-replaces").textContent).toBe(
      "Replaces Assay app on this Mac. Its tool limits are kept.",
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "agt-1" } });
    expect(screen.getByTestId("consent-replaces").textContent).toBe(
      "This keeps Assay app on this Mac connected. It will not be replaced.",
    );
  });

  it("OAUTH_CREDENTIAL_NAME_INVALID shows on the name field", async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError("OAUTH_CREDENTIAL_NAME_INVALID", "x", 400));
    mount({ onApprove });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(screen.getByText("Use a name with letters or numbers. Invisible and control characters are removed.")).toBeTruthy();
  });

  it("an empty name is refused without calling the API", async () => {
    const { onApprove } = mount();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "  " } });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText("Give this connection a name.")).toBeTruthy();
  });

  it("already decided → the request is over, and the page is told", async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError("OAUTH_REQUEST_ALREADY_DECIDED", "x", 409));
    const onFinal = vi.fn();
    mount({ onApprove, onFinal });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(screen.getByTestId("consent-final").textContent).toBe("You already answered this request.");
    expect(onFinal).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("Cancel denies", async () => {
    const { onDeny, onApprove } = mount();
    arm();
    await act(async () => {
      press(cancel());
    });
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });
});

describe("signing in again for the same agent (replacesAgent)", () => {
  it("approves as that agent with no picker and says so", async () => {
    const { onApprove } = mount({ request: request({ replacesAgent: { id: "agt-1", name: "research-bot" } }) });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("consent-relogin").textContent).toBe("Signing in again for research-bot.");
    arm();
    await act(async () => {
      press(approve());
    });
    expect(onApprove).toHaveBeenCalledWith({ agentId: "agt-1", name: "Claude Code · 2026-10-19" });
  });

  it("a 409 OAUTH_REPLACE_AGENT_MISMATCH ends the request with the API's words (review m3)", async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError("OAUTH_REPLACE_AGENT_MISMATCH", "Sign out in the app first, then connect again.", 409));
    const onFinal = vi.fn();
    mount({ onApprove, onFinal, request: request({ replacesAgent: { id: "agt-1", name: "research-bot" } }) });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(screen.getByTestId("consent-final").textContent).toBe("Sign out in the app first, then connect again.");
    expect(onFinal).toHaveBeenCalled();
  });

  it("a paused locked agent refused by the API says resume it or sign out (review m4)", async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError("OAUTH_AGENT_NOT_ACTIVE", "x", 409));
    mount({ onApprove, request: request({ replacesAgent: { id: "agt-1", name: "research-bot" } }) });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(screen.getByRole("alert").textContent).toBe(
      "research-bot is paused. Resume it in Agents & keys, or sign out in the app to connect another agent.",
    );
    expect(document.body.textContent).not.toContain("Pick another");
  });

  it("without the field the picker stays", () => {
    mount();
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.queryByTestId("consent-relogin")).toBeNull();
  });
});

describe("request id", () => {
  afterEach(() => {
    forgetRequestId();
    window.history.replaceState(null, "", "/");
  });

  it("hash stripped after read", () => {
    window.history.replaceState(null, "", `/connect/authorize#request=${RID}`);
    expect(takeRequestId()).toBe(RID);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(RID);
    expect(window.location.pathname).toBe("/connect/authorize");
    expect(window.sessionStorage.getItem(RID_STORAGE_KEY)).toBe(RID);
  });

  it("is found again after a sign-in round trip, and forgotten after a decision", () => {
    window.history.replaceState(null, "", `/connect/authorize#request=${RID}`);
    takeRequestId();
    window.history.replaceState(null, "", "/connect/authorize");
    expect(takeRequestId()).toBe(RID);
    forgetRequestId();
    expect(takeRequestId()).toBeNull();
  });

  it("a malformed id is stripped and never kept", () => {
    window.history.replaceState(null, "", "/connect/authorize#request=../../x");
    expect(takeRequestId()).toBeNull();
    expect(window.location.hash).toBe("");
    expect(window.sessionStorage.getItem(RID_STORAGE_KEY)).toBeNull();
  });
});

describe("consent routes", () => {
  const ROUTES = ["src/app/(main)/connect/authorize/page.tsx", "src/app/(main)/connect/authorize-error/page.tsx"];

  it("import no analytics", () => {
    for (const route of ROUTES) {
      const source = readFileSync(resolve(process.cwd(), route), "utf8");
      const imports = source.match(/^import[^;]+;/gm) ?? [];
      expect(imports.length).toBeGreaterThan(0);
      for (const line of imports) {
        expect(line).not.toMatch(/analytics|gtag|posthog|segment|mixpanel|amplitude|plausible|sentry|datadog|hotjar/i);
      }
    }
  });
});

describe("I5: Approve and set limits", () => {
  function setup(overrides: Partial<React.ComponentProps<typeof ConsentCard>> = {}, saveResult: "ok" | "fail" = "ok") {
    const save = vi.fn(() => (saveResult === "ok" ? Promise.resolve() : Promise.reject(new Error("save failed"))));
    function FakeSheet(props: LimitsSheetProps) {
      if (!props.open) return null;
      return (
        <div role="dialog">
          <p>{props.intro}</p>
          <button
            type="button"
            onClick={async () => {
              const reason = await props.beforeSave();
              if (reason) return;
              try {
                await save();
              } catch {
                return;
              }
              props.onOpenChange(false);
              props.onSaved();
            }}
          >
            {props.saveLabel}
          </button>
        </div>
      );
    }
    const handles = mount({
      setLimits: (slot) => <ConsentSetLimitsControl slot={slot} Sheet={FakeSheet} />,
      ...overrides,
    });
    return { ...handles, save };
  }
  const openButton = () => screen.getByRole("button", { name: "Approve and set limits" }) as HTMLButtonElement;
  const saveButton = () => screen.getByRole("button", { name: "Save and approve" }) as HTMLButtonElement;

  it("saves, then approves once", async () => {
    const recheck = vi.fn().mockResolvedValue(undefined);
    const { onApprove, save } = setup({ recheck });
    arm();
    await act(async () => {
      press(openButton());
    });
    expect(screen.getByText("These limits apply to everything ops-bot does, not only to this app.")).toBeTruthy();
    await act(async () => {
      press(saveButton());
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(recheck).toHaveBeenCalledTimes(2); // before opening, and before saving
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith({ agentId: "agt-2", name: "Claude Code · 2026-10-19" });
  });

  it("an empty name: the sheet does not open and nothing is saved", async () => {
    const { onApprove, save } = setup();
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "\u200b " } });
    arm();
    await act(async () => {
      press(openButton());
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText("Give this connection a name.")).toBeTruthy();
  });

  it("the request ended while the sheet was open: nothing is saved", async () => {
    const recheck = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ApiError("OAUTH_REQUEST_NOT_FOUND", "x", 404));
    const { onApprove, save } = setup({ recheck });
    arm();
    await act(async () => {
      press(openButton());
    });
    await act(async () => {
      press(saveButton());
    });
    expect(save).not.toHaveBeenCalled();
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByTestId("consent-final").textContent).toBe(
      "This request expired. Go back to your app and try again.",
    );
  });

  it("a failed save does not approve", async () => {
    const { onApprove, save } = setup({}, "fail");
    arm();
    await act(async () => {
      press(openButton());
    });
    await act(async () => {
      press(saveButton());
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("approve refused after the save: says the limits were saved and the app was not approved", async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError("OAUTH_GRANT_LIMIT_REACHED", "x", 409));
    setup({ onApprove });
    arm();
    await act(async () => {
      press(openButton());
    });
    await act(async () => {
      press(saveButton());
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "Your limits were saved, but the app was not approved: This agent already has 50 connected apps, the most it can have. Revoke ones you no longer use in Agents & keys.",
      ),
    ).toBeTruthy();
  });
});

describe("m7: a decision whose answer was lost", () => {
  it("offers to return to the app when the retry reads as already answered", async () => {
    const onApprove = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockRejectedValueOnce(new ApiError("OAUTH_REQUEST_ALREADY_DECIDED", "x", 409));
    const onResume = vi.fn();
    mount({ onApprove, onResume });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(screen.getByText("That did not go through. Try again.")).toBeTruthy();
    await act(async () => {
      press(approve());
    });
    fireEvent.click(screen.getByRole("button", { name: "Return to the app" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("no such offer for a 409 without a lost answer first", async () => {
    const onApprove = vi.fn().mockRejectedValue(new ApiError("OAUTH_REQUEST_ALREADY_DECIDED", "x", 409));
    mount({ onApprove, onResume: vi.fn() });
    arm();
    await act(async () => {
      press(approve());
    });
    expect(screen.queryByRole("button", { name: "Return to the app" })).toBeNull();
  });
});

describe("fix round 2, R4: the arming press never saves limits", () => {
  it("sheet open, page hidden and shown, first tap on Save arms only: nothing saved; second tap saves and approves", async () => {
    const save = vi.fn(() => Promise.resolve());
    function FakeSheet(props: LimitsSheetProps) {
      if (!props.open) return null;
      return (
        <button
          type="button"
          onClick={async () => {
            if (await props.beforeSave()) return;
            await save();
            props.onOpenChange(false);
            props.onSaved();
          }}
        >
          {props.saveLabel}
        </button>
      );
    }
    const { onApprove } = mount({
      recheck: vi.fn().mockResolvedValue(undefined),
      setLimits: (slot) => <ConsentSetLimitsControl slot={slot} Sheet={FakeSheet} />,
    });
    arm();
    await act(async () => {
      press(screen.getByRole("button", { name: "Approve and set limits" }));
    });
    // Hidden and shown again: the buttons disarm and the delay starts over.
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(ACTIVATION_DELAY_MS);
    });
    // A touch tap: no pointermove, its pointerdown arms, then its click.
    const saveButton = () => screen.getByRole("button", { name: "Save and approve" });
    act(() => {
      fireEvent.pointerDown(saveButton());
    });
    await act(async () => {
      fireEvent.click(saveButton());
    });
    expect(save).not.toHaveBeenCalled();
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByText("Tap again to confirm.")).toBeTruthy();
    // The second tap acts.
    await act(async () => {
      press(saveButton());
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});

describe("fix round 2, R1: the Not verified pill", () => {
  it("sits on the name's line, in its own element, for every unverified client", () => {
    mount({
      request: request({
        client: { ...request().client, name: "Claude Code Ｖｅｒｉｆｉｅｄ", verified: false },
      }),
    });
    const line = screen.getByTestId("consent-client-line");
    expect(screen.getByTestId("consent-client").textContent).toBe("Claude Code");
    const pill = screen.getByTestId("consent-not-verified-pill");
    expect(pill.parentElement).toBe(line);
    expect(pill.textContent).toBe("Not verified");
  });

  it("no pill for a verified client", () => {
    mount();
    expect(screen.queryByTestId("consent-not-verified-pill")).toBeNull();
  });
});
