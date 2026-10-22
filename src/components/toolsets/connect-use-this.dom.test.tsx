import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/ui/sheet";

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
const HOST = "https://mcp.example.com";
const KEY = { id: "k1", agentId: AGENT, name: "laptop", hint: "assay_sk_live_…ab12", scopes: ["tools:call", "payments", "activity:read"], lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: "2026-10-18T00:00:00Z" };

function render(initialUrl: string, servers: unknown[] = []): string {
  vi.stubEnv("NEXT_PUBLIC_MCP_URL", `${HOST}/`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["catalogue", "providers"], { providers: [] });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({ items: [{ agentId: AGENT, label: "My agent" }], pageInfo: { nextCursor: null, hasMore: false } }));
  client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: [KEY] }));
  client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(toolsetKeys.servers(AGENT), { overBudget: false, servers });
  client.setQueryData(["spend-policy"], null);
  // Measured: the longest tool is 13 characters, so names up to 44 fit.
  client.setQueryData(toolsetKeys.preview(initialUrl, AGENT), { canonicalUrl: initialUrl, endpointKind: "ROOT", toolsetId: null, toolsetName: null, viewFilter: null, discovery: "FULL", listedCount: 1, listedTools: ["get_weather"], estimatedTokens: 10, freeOnly: false, tools: [], ignoredTools: [], warnings: [] });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Sheet open>
        <ConnectBody agentProp={AGENT} initialUrl={initialUrl} changing={false} onDone={() => undefined} />
      </Sheet>
    </QueryClientProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const nameValue = (html: string) => /data-testid="connect-name"[\s\S]*?value="([^"]*)"/.exec(html)?.[1];

afterEach(() => vi.unstubAllEnvs());

describe("Use this ...: the URL and the name (spec 9.3)", () => {
  it("tool page: /?tools={name}, name assay-{first word}", () => {
    const html = render(`${HOST}/?tools=get_weather`);
    expect(nameValue(html)).toBe("assay-weather");
    expect(text(html)).toContain(`--url '${HOST}/?tools=get_weather' --name assay-weather`);
  });

  it("other's tool set: pinned @latest", () => {
    const html = render(`${HOST}/@acme/trip-planner@3`);
    expect(text(html)).toContain(`${HOST}/@acme/trip-planner@3`);
    expect(nameValue(html)).toBe("assay-trip-planner");
  });

  it("link-only: /u/{token}@{n}", () => {
    const token = "abcdefghijklmnopqrstuv";
    const html = render(`${HOST}/u/${token}@2`);
    expect(text(html)).toContain(`${HOST}/u/${token}@2`);
  });

  it("my tool set: /my/{slug}; Lock adds @N", () => {
    expect(text(render(`${HOST}/my/research`))).toContain(`${HOST}/my/research --name assay-research`);
    expect(text(render(`${HOST}/my/research@4`))).toContain(`${HOST}/my/research@4 --name assay-research`);
  });

  it("topic: /c/{category}", () => {
    const html = render(`${HOST}/c/weather`);
    expect(text(html)).toContain(`${HOST}/c/weather`);
    expect(nameValue(html)).toBe("assay-weather");
  });

  it("shows the add one-liner for a URL other than /, and not for /", () => {
    expect(text(render(`${HOST}/c/weather`))).toContain(`add ${HOST}/c/weather --client claude-code`);
    expect(text(render(`${HOST}/`))).not.toContain("@goassay-ai/mcp@1.2.3 add");
  });
});

describe("the editable name", () => {
  it("has a name field with the rule hint", () => {
    const html = render(`${HOST}/c/weather`);
    expect(html).toContain('data-testid="connect-name"');
    expect(text(html)).toContain("Lowercase letters, digits and -");
  });

  it("a suggested name always fits: trailing words are dropped", () => {
    const html = render(`${HOST}/my/${"alpha-".repeat(6)}omega`);
    expect(text(html)).not.toContain("is too long");
    expect(nameValue(html)!.length + 7 + 13).toBeLessThanOrEqual(64);
  });
});

describe("a second URL", () => {
  const other = { canonicalUrl: `${HOST}/`, endpointKind: "ROOT", toolsetId: null, name: "Everything", serverName: "assay", client: "claude-code", toolCount: 5, estimatedTokens: 100, discovery: "SEARCH", lastCallAt: null, handedOutAt: null, firstCallAt: null, waitingForFirstCall: false, available: true, updateAvailable: false };

  it("remote-only second URL shows the R-UI-11 text", () => {
    const html = render(`${HOST}/c/weather`, [other]);
    expect(text(html)).toContain("This signs in again and appears as another app in Agents & keys.");
  });

  it("no note when there is no other server", () => {
    expect(text(render(`${HOST}/c/weather`))).not.toContain("signs in again");
  });
});

describe("a typed name that does not fit", () => {
  it("shows the refusal and the suggestion, and no command", async () => {
    const { serverNameRefusal } = await import("@/features/connect/mcp-url");
    const refusal = serverNameRefusal("assay-weather-forecast-and-alerts-for-everyone", 48);
    expect(refusal?.kind).toBe("tooLong");
    expect(refusal?.message).toContain("Try `assay");
  });

  it("renders no command, deeplink or enabled Copy for any app while the name is refused (review I-1)", async () => {
    const { McpConfigTabs } = await import("@/components/buyer-money/mcp-config-tabs");
    const { MCP_CLIENTS, NO_COMMAND_TEXT } = await import("@/features/buyer-money/mcp-config");
    for (const { id } of MCP_CLIENTS) {
      if (id === "claude-ai" || id === "chatgpt") continue; // hosted connectors take no name
      const html = renderToStaticMarkup(
        <McpConfigTabs guide token={null} url={`${HOST}/c/weather`} client={id} serverName="assay-weather-forecast-and-alerts-for-everyone" nameRefused />,
      );
      expect(html, id).toContain(NO_COMMAND_TEXT);
      expect(html, id).not.toMatch(/npx -y @goassay-ai\/mcp@|cursor:\/\/|vscode:|mcpServers|PASTE_YOUR_KEY_ENDING/);
      // Every Copy of a command or config is off; copying the bare URL ("Copy the URL only", the URL chip) carries no name.
      const enabledCopies = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].filter(
        ([, attrs, inner]) => !attrs!.includes('disabled=""') && !attrs!.includes('data-testid="copy-url-only"') && !attrs!.includes(`title="${HOST}/c/weather"`) && /Copy/.test(inner!),
      );
      expect(enabledCopies, id).toHaveLength(0);
    }
  });
});

describe("link-only sets, hosted apps and duplicate names (spec 9.3, 9.4)", () => {
  it("a link-only set's name is assay-shared only while its slug is unknown", () => {
    const token = "abcdefghijklmnopqrstuv";
    const html = render(`${HOST}/u/${token}@2`);
    expect(nameValue(html)).toBe("assay");
  });

  it("hosted apps take no name: a name field is not shown and nothing is refused", async () => {
    const { McpConfigTabs } = await import("@/components/buyer-money/mcp-config-tabs");
    for (const id of ["claude-ai", "chatgpt"] as const) {
      const html = renderToStaticMarkup(<McpConfigTabs guide token={null} url={`${HOST}/c/weather`} client={id} serverName="Bad Name" nameRefused={false} />);
      expect(html, id).toContain(`${HOST}/c/weather?free=1`);
    }
  });

  it("step 1 is claude.ai's wording only for claude.ai", async () => {
    const { McpConfigTabs } = await import("@/components/buyer-money/mcp-config-tabs");
    const claude = text(renderToStaticMarkup(<McpConfigTabs guide token={null} url={`${HOST}/`} client="claude-ai" serverName="assay" />));
    const chatgpt = text(renderToStaticMarkup(<McpConfigTabs guide token={null} url={`${HOST}/`} client="chatgpt" serverName="assay" />));
    expect(claude).toContain("Open Settings › Connectors › Add custom connector.");
    expect(chatgpt).not.toContain("Settings › Connectors › Add custom connector");
    expect(chatgpt).toContain("ChatGPT");
  });

  it("flags a typed name another server of the agent already uses", () => {
    const taken = { canonicalUrl: `${HOST}/c/news`, endpointKind: "TOPIC", toolsetId: null, name: "News", serverName: "assay-weather", client: "claude-code", toolCount: 1, estimatedTokens: 10, discovery: "FULL", lastCallAt: null, handedOutAt: null, firstCallAt: null, waitingForFirstCall: false, available: true, updateAvailable: false };
    // The suggestion is made unique, so it is never flagged; only a typed duplicate is (see the sheet's hint).
    const html = render(`${HOST}/c/weather`, [taken]);
    expect(nameValue(html)).toBe("assay-weather-2");
    expect(text(html)).not.toContain("already has a server named");
  });

  it("the Free-only switch is on whenever the URL carries free=1", () => {
    const html = render(`${HOST}/c/weather?free=1`);
    expect(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*>/.test(html) || html.includes('checked=""')).toBe(true);
  });
});
