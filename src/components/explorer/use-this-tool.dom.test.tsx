import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { safeNextPath } from "@/libs/login-redirect";
import { routes } from "@/libs/routes";

const privy = vi.hoisted(() => ({ authenticated: false }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: privy.authenticated }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { UseThisTool } from "@/components/g31/tools-view";

import { StartFreeCta } from "./start-free";

const hrefOf = (html: string) => html.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;

describe("Use this tool: back to Connect with the tool chosen", () => {
  const next = routes.connectTools(["get_weather"]);

  it("signed out, signs in and comes back to /connect?tools=…", () => {
    privy.authenticated = false;
    const html = renderToStaticMarkup(<StartFreeCta next={next} label="Use this tool" signedInLabel="Use this tool" />);
    const href = hrefOf(html)!;
    expect(href).toBe("/login?next=%2Fconnect%3Ftools%3Dget_weather");
    // What /login does with it: the same path and query, nothing else.
    expect(safeNextPath(new URLSearchParams(href.split("?")[1]).get("next"))).toBe("/connect?tools=get_weather");
    expect(html).toContain("Use this tool");
  });

  it("signed in, goes straight there with the same label", () => {
    privy.authenticated = true;
    const html = renderToStaticMarkup(<StartFreeCta next={next} label="Use this tool" signedInLabel="Use this tool" />);
    expect(hrefOf(html)).toBe("/connect?tools=get_weather");
    expect(html).toContain("Use this tool");
    expect(html).not.toContain("Open app");
  });

  it("in the app, links the tool's MCP name to Connect", () => {
    const html = renderToStaticMarkup(<UseThisTool tool={{ name: "get_weather", toolId: "t1" }} />);
    expect(hrefOf(html)).toBe("/connect?tools=get_weather");
    expect(html).toContain('data-testid="use-this-tool"');
  });

  it("shows nothing for a tool with no MCP name", () => {
    expect(renderToStaticMarkup(<UseThisTool tool={{ name: "Market quote", toolId: "Not A Name" }} />)).toBe("");
  });
});
