import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { McpConfigTabs, TEMPLATE_COPY_REASON } from "@/components/buyer-money/mcp-config-tabs";
import { toolsPrefillUrl } from "@/components/g31/connect-view";
import { Sheet } from "@/components/ui/sheet";
import { pasteHint } from "@/features/buyer-money/mcp-config";

import { ConnectBody } from "./connect-sheet";
import { toolsetKeys } from "./use-toolsets";
import { AGENTS_WITH_KEYS_KEY } from "@/components/buyer-money/use-agents";
import { demoAgentsWithKeys, withDemoKeys } from "@/libs/demo/demo-agent-health";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/" }));

const AGENT = "11111111-1111-1111-1111-111111111111";

function render(node: React.ReactNode, keys: unknown[] = []): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["catalogue", "providers"], { providers: [] });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({ items: [{ agentId: AGENT, label: "My agent" }], pageInfo: { nextCursor: null, hasMore: false } }));
  client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: keys }));
  client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["spend-policy"], null);
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const KEY = {
  id: "k1",
  agentId: AGENT,
  name: "laptop",
  prefix: "assay_sk_live_ab12",
  scopes: ["tools:call", "payments", "activity:read"],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-10-18T00:00:00Z",
};

const GRANT = { ...KEY, id: "g1", name: "Claude Code · 2026-10-18", prefix: null, oauthClient: { name: "Claude Code" } };

describe("the key hint skips an app sign-in (OAuth grant, null prefix)", () => {
  it("names the API key even when a grant comes first", () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "https://mcp.example.com/");
    const html = render(<Sheet open><ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} /></Sheet>, [GRANT, KEY]);
    const out = text(html);
    // The default tab is the proxy install: it signs in, so no key line and no key in it (M1-04 follow-up).
    // The key goes under "My own code".
    expect(out).not.toContain("Uses the live key");
    expect(out).not.toContain("REST_OF_YOUR_KEY");
    expect(out).toContain("@goassay-ai/mcp@1.2.3");
    expect(out).not.toContain("null");
    const own = text(render(<McpConfigTabs token={null} keyPrefix="assay_sk_live_ab12" url="https://mcp.example.com/" client="other" />));
    expect(own).toContain("assay_sk_live_ab12…REST_OF_YOUR_KEY");
  });

  it("with only a grant, the sign-in tab says nothing about a missing key, never 'null…' (BUG-M1-04)", () => {
    const out = text(render(<Sheet open><ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} /></Sheet>, [GRANT]));
    // The default tab is the proxy install, which signs in: it needs no key.
    expect(out).not.toContain("has no key yet");
    expect(out).not.toContain("null");
    expect(out).not.toContain("Claude Code · 2026-10-18");
  });
});

describe("Use this tool: /connect?tools= preselects Only these tools", () => {
  it("reads ?tools= into the sheet's prefill URL, and refuses what is not a tool name", () => {
    expect(toolsPrefillUrl("?tools=get_weather")).toMatch(/\/\?tools=get_weather$/);
    expect(toolsPrefillUrl("?tools=get_weather,search_web")).toMatch(/\?tools=get_weather,search_web$/);
    expect(toolsPrefillUrl("")).toBeNull();
    expect(toolsPrefillUrl("?tools=")).toBeNull();
    expect(toolsPrefillUrl("?tools=%3Cscript%3E")).toBeNull();
  });

  it("opens with Only these tools chosen, the tool listed, and the title naming tool and agent", () => {
    const url = toolsPrefillUrl("?tools=get_weather")!;
    const html = render(<Sheet open><ConnectBody agentProp={AGENT} initialUrl={url} changing={false} onDone={() => undefined} /></Sheet>, [KEY]);
    const out = text(html);
    expect(out).toContain("Connect get_weather to My agent");
    // The one checked answer is "Only these tools", and its chosen list holds the tool.
    const checked = html.split('name="connect-choice"').filter((part) => part.startsWith(' checked=""') || /^[^>]*checked=""/.test(part));
    expect(checked).toHaveLength(1);
    expect(text(checked[0]!.slice(checked[0]!.indexOf(">") + 1))).toMatch(/^\s*Only these tools/);
    expect(html).toMatch(/aria-label="Chosen tools"[\s\S]*get_weather/);
  });

  it("puts Use an API key instead first, keeps Copy off while the snippet has a placeholder, and offers the URL alone", () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "https://mcp.example.com/");
    const url = toolsPrefillUrl("?tools=get_weather")!;
    const html = render(<Sheet open><ConnectBody agentProp={AGENT} initialUrl={url} changing={false} onDone={() => undefined} /></Sheet>, [KEY]);
    const out = text(html);
    // The default tab is the proxy install: ready to copy, no key needed.
    expect(out).toContain("npx -y @goassay-ai/mcp@1.2.3 --url");
    expect(html).toMatch(/<button[^>]*data-testid="connect-copy"/);
    // The proxy install signs in: no key line under it (M1-04 follow-up).
    expect(out).not.toContain("Uses the live key");
  });
});

describe("a refused install leaves nothing to copy (review N-1)", () => {
  const copyButton = (html: string) => html.match(/<button[^>]*data-testid="connect-copy"[^>]*>/)?.[0] ?? "";

  it("keeps Copy off when the MCP host is not a usable URL, so nothing is copied or recorded", () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "");
    const html = render(<Sheet open><ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} /></Sheet>, [KEY]);
    expect(html).not.toContain("npx -y @goassay-ai/mcp@");
    expect(copyButton(html)).toMatch(/disabled=""/);
  });

  it("turns Copy on once the install command is shown", () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "https://mcp.example.com/");
    const html = render(<Sheet open><ConnectBody agentProp={AGENT} initialUrl={null} changing={false} onDone={() => undefined} /></Sheet>, [KEY]);
    expect(text(html)).toContain("npx -y @goassay-ai/mcp@1.2.3");
    expect(copyButton(html)).not.toMatch(/disabled=""/);
  });
});

describe("the config tabs", () => {
  it("disable Copy while the snippet holds a placeholder, and enable it with the full key", () => {
    const template = render(<McpConfigTabs token={null} keyPrefix="assay_sk_live_ab12" url="https://mcp.example.com/" client="other" />);
    expect(template).toContain(TEMPLATE_COPY_REASON);
    expect(template).toMatch(/<button[^>]*disabled=""[^>]*title=/);
    const ready = render(<McpConfigTabs token="assay_sk_live_full" url="https://mcp.example.com/" client="other" />);
    expect(ready).not.toContain(TEMPLATE_COPY_REASON);
  });

  it("offer Use an API key instead under My own code only (R-UI-8)", () => {
    const own = text(render(<McpConfigTabs token={null} keyPrefix={null} url="https://mcp.example.com/" client="other" onCreateKey={() => undefined} />));
    expect(own).toContain("Use an API key instead");
    const proxy = text(render(<McpConfigTabs token={null} keyPrefix={null} url="https://mcp.example.com/" onCreateKey={() => undefined} />));
    expect(proxy).not.toContain("Use an API key instead");
  });

  it("say Claude Desktop requires Node.js", () => {
    expect(pasteHint("claude-desktop")).toMatch(/^Requires Node\.js/);
  });
});
