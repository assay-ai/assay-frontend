// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { appNavigate, isStrictPagePath, useFullLoadLinks } from "./strict-pages";

afterEach(() => {
  cleanup();
});

describe("isStrictPagePath", () => {
  it("matches /connect/* and /agents/enable-paid, as _headers does", () => {
    for (const path of ["/connect/authorize", "/connect/authorize-error?reason=x", "/connect/preview", "/agents/enable-paid", "/agents/enable-paid/"]) {
      expect(isStrictPagePath(path)).toBe(true);
    }
    for (const path of ["/connect", "/connect/", "/agents", "/login", null, undefined, ""]) {
      expect(isStrictPagePath(path)).toBe(false);
    }
  });
});

describe("useFullLoadLinks", () => {
  function Links({ load }: { load: (href: string) => void }) {
    useFullLoadLinks(load);
    return (
      <>
        <a href="/agents?x=1">in app</a>
        <a href="https://docs.example.com/">elsewhere</a>
        <a href="/agents" target="_blank">new tab</a>
      </>
    );
  }

  it("loads a same-origin link as a new document", () => {
    const load = vi.fn();
    render(<Links load={load} />);
    const event = fireEvent.click(screen.getByText("in app"));
    expect(event).toBe(false); // default prevented
    expect(load).toHaveBeenCalledWith("/agents?x=1");
  });

  it("leaves other origins, new tabs and modified clicks alone", () => {
    const load = vi.fn();
    render(<Links load={load} />);
    // jsdom cannot navigate: stop the browser's own default after the hook has looked.
    const stop = (event: Event) => event.preventDefault();
    window.addEventListener("click", stop);
    fireEvent.click(screen.getByText("elsewhere"));
    fireEvent.click(screen.getByText("new tab"));
    fireEvent.click(screen.getByText("in app"), { metaKey: true });
    expect(load).not.toHaveBeenCalled();
    window.removeEventListener("click", stop);
  });
});

describe("appNavigate (fix round 2, R3)", () => {
  const router = () => ({ push: vi.fn(), replace: vi.fn() });

  it("from a strict page: a full page load, never the router", () => {
    for (const pathname of ["/connect/authorize", "/agents/enable-paid"]) {
      const r = router();
      const load = vi.fn();
      appNavigate(r, "/login", { replace: true, pathname, load });
      appNavigate(r, "/alerts", { pathname, load });
      expect(load.mock.calls).toEqual([["/login"], ["/alerts"]]);
      expect(r.push).not.toHaveBeenCalled();
      expect(r.replace).not.toHaveBeenCalled();
    }
  });

  it("elsewhere: the router, push or replace as asked", () => {
    const r = router();
    const load = vi.fn();
    appNavigate(r, "/alerts", { pathname: "/agents", load });
    appNavigate(r, "/login", { replace: true, pathname: "/agents", load });
    expect(r.push).toHaveBeenCalledWith("/alerts");
    expect(r.replace).toHaveBeenCalledWith("/login");
    expect(load).not.toHaveBeenCalled();
  });

  it("defaults to the current path", () => {
    window.history.replaceState(null, "", "/connect/authorize");
    const r = router();
    const load = vi.fn();
    appNavigate(r, "/calls", { load });
    expect(load).toHaveBeenCalledWith("/calls");
    window.history.replaceState(null, "", "/");
    appNavigate(r, "/calls", { load });
    expect(r.push).toHaveBeenCalledWith("/calls");
  });

  it("the shell's sign out, alerts bell, mobile search and search go through it", () => {
    const sites: [string, RegExp][] = [
      ["src/components/layout/wallet-menu.tsx", /appNavigate\(router, "\/login", \{ replace: true \}\)/],
      ["src/app/(main)/layout.tsx", /appNavigate\(router, "\/alerts", \{ pathname \}\)/],
      ["src/app/(main)/layout.tsx", /appNavigate\(router, routes\.calls\(\), \{ pathname \}\)/],
      ["src/components/layout/buyer-search.tsx", /appNavigate\(router, suggestion\.href\)/],
      ["src/providers/PrivySessionBridge.tsx", /appNavigate\(router, href, \{ replace: true, pathname: pathnameRef\.current \}\)/],
    ];
    for (const [file, pattern] of sites) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).toMatch(pattern);
      expect(source, file).not.toMatch(/router\.(push|replace)\(/);
    }
  });
});
