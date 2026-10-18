// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isStrictPagePath, useFullLoadLinks } from "./strict-pages";

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
