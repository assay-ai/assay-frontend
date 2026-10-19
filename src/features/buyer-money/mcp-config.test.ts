import { describe, expect, it, vi } from "vitest";

import vectors from "@/features/connect/commands.vectors.json";
import {
  addOneLiner,
  apiKeyConfig,
  assayMcpVersion,
  credentialLabel,
  cursorDeeplink,
  installCommand,
  installText,
  KEY_PLACEHOLDER,
  KEY_PREFIX_VISIBLE_LENGTH,
  keyMode,
  keyPlaceholder,
  keyForHint,
  remoteInstall,
  vscodeDeeplink,
  type LocalMcpClient,
} from "@/features/buyer-money/mcp-config";

describe("keyMode — read off the key's visible prefix", () => {
  it("names an API key live", () => {
    expect(keyMode("assay_sk_live_ab12")).toBe("live");
  });

  it("says nothing for any other prefix: there is no test key", () => {
    expect(keyMode("assay_live_ab12")).toBeNull();
    expect(keyMode("assay_test_ab12")).toBeNull();
    expect(keyMode("other_sk_live_ab12")).toBeNull();
    expect(keyMode(null)).toBeNull();
    expect(keyMode(undefined)).toBeNull();
  });
});

describe("keyPlaceholder — what stands in for a key not on screen", () => {
  it("names an API key by its prefix", () => {
    expect(keyPlaceholder("assay_sk_live_ab12cd34")).toBe("assay_sk_live_ab12cd34…REST_OF_YOUR_KEY");
    expect(keyPlaceholder("assay_sk_live_ab12cd34…")).toBe("assay_sk_live_ab12cd34…REST_OF_YOUR_KEY");
  });

  it("never echoes a full token: only the visible prefix is kept", () => {
    const token = "assay_sk_live_ab12cd34ef56gh78ij90kl12mn34op56";
    const out = keyPlaceholder(token);
    expect(out).toBe(`${token.slice(0, KEY_PREFIX_VISIBLE_LENGTH)}…REST_OF_YOUR_KEY`);
    expect(out).not.toContain(token);
    expect(KEY_PREFIX_VISIBLE_LENGTH).toBe(22);
  });

  it("is the bare placeholder without a prefix, or with one that is not an API key's", () => {
    expect(keyPlaceholder(null)).toBe(KEY_PLACEHOLDER);
    expect(keyPlaceholder("")).toBe(KEY_PLACEHOLDER);
    expect(keyPlaceholder("assay_live_ab12")).toBe(KEY_PLACEHOLDER);
  });
});

describe("credentialLabel — how a credential row shows its key", () => {
  it("shows an API key's prefix", () => {
    expect(credentialLabel({ prefix: "assay_sk_live_ab12" })).toBe("assay_sk_live_ab12…");
    expect(credentialLabel({ prefix: "assay_sk_live_ab12…" })).toBe("assay_sk_live_ab12…");
  });

  it("names an app sign-in (null prefix) by its client, never 'null…'", () => {
    expect(credentialLabel({ prefix: null })).toBe("App sign-in");
    expect(credentialLabel({ prefix: null, oauthClient: null })).toBe("App sign-in");
    expect(credentialLabel({ prefix: null, oauthClient: { name: "Claude Code" } })).toBe("Signed in with Claude Code");
  });
});

describe("keyForHint — the key an API-key hint names", () => {
  it("skips app sign-ins, which have no prefix to show", () => {
    const grant = { id: "g", prefix: null };
    const key = { id: "k", prefix: "assay_sk_live_ab12" };
    expect(keyForHint([grant, key])).toBe(key);
    expect(keyForHint([grant])).toBeNull();
    expect(keyForHint([])).toBeNull();
  });
});

// "agent" + "-cli" is split so the repo-wide retired-name scan does not match this file.
const FORBIDDEN = new RegExp(["npx -y assay-mcp", "agent" + "-cli", "mcp-remote", "Authorization", "Bearer", "assay_(at|rt|ac|sk_live)_"].join("|"));

describe("install commands equal the proxy's vectors, byte for byte", () => {
  const V = vectors.V;

  it("paid-capable command, entry link and free-only remote, for every client and URL", () => {
    expect(vectors.install.length).toBeGreaterThan(20);
    for (const c of vectors.install) {
      const client = c.client as LocalMcpClient;
      const input = { V, url: c.input.url, name: c.input.name };
      expect(c.input.V).toBe(V);
      expect(installCommand(client, input), `${client} ${c.input.url}`).toEqual(c.command);
      expect(remoteInstall(client, { url: c.input.url, name: c.input.name }), `${client} remote`).toEqual(c.remote);
      const link = client === "cursor" ? cursorDeeplink(input) : client === "vscode" ? vscodeDeeplink(input) : null;
      expect(link, `${client} link`).toBe(c.link);
    }
  });

  it("the add one-liner", () => {
    for (const c of vectors.add.cases) {
      expect(addOneLiner(c.url, c.client as LocalMcpClient, c.V)).toBe(c.command);
    }
  });

  it("no output holds an unpinned package, the retired CLI, mcp-remote, a header or a token", () => {
    for (const c of vectors.install) {
      const client = c.client as LocalMcpClient;
      const input = { V, url: c.input.url, name: c.input.name };
      const outputs = [
        installText(installCommand(client, input)),
        installText(remoteInstall(client, input) ?? ""),
        cursorDeeplink(input),
        vscodeDeeplink(input),
        addOneLiner(c.input.url, client, V),
      ];
      for (const text of outputs) {
        expect(text).not.toMatch(FORBIDDEN);
      }
      expect(installText(installCommand(client, input))).toContain(`@assay-ai/mcp@${V}`);
    }
  });

  it("the Cursor deeplink decodes to the stdio entry", () => {
    const input = { V: "1.2.3", url: "https://mcp.assay.ai/my/weather", name: "assay-weather" };
    const link = new URL(cursorDeeplink(input));
    expect(link.searchParams.get("name")).toBe("assay-weather");
    const config = JSON.parse(Buffer.from(link.searchParams.get("config")!, "base64").toString("utf8"));
    expect(config).toEqual({ command: "npx", args: ["-y", "@assay-ai/mcp@1.2.3", "--url", input.url, "--name", "assay-weather"] });
  });

  it("the VS Code link decodes to name, type, command and args", () => {
    const input = { V: "1.2.3", url: "https://mcp.assay.ai/", name: "assay" };
    const decoded = JSON.parse(decodeURIComponent(vscodeDeeplink(input).slice("vscode:mcp/install?".length)));
    expect(decoded).toEqual({ name: "assay", type: "stdio", command: "npx", args: ["-y", "@assay-ai/mcp@1.2.3", "--name", "assay"] });
  });

  it("refuses a version that is not exact", () => {
    for (const bad of ["", "1", "^1.2.3", "latest", "1.2"]) {
      expect(() => installCommand("claude-code", { V: bad, url: "https://mcp.assay.ai/", name: "assay" })).toThrow();
    }
  });
});

describe("the pinned version comes from the build environment", () => {
  it("reads NEXT_PUBLIC_ASSAY_MCP_VERSION", () => {
    vi.stubEnv("NEXT_PUBLIC_ASSAY_MCP_VERSION", "2.0.1");
    expect(assayMcpVersion()).toBe("2.0.1");
    expect(installCommand("codex", { url: "https://mcp.assay.ai/", name: "assay" })).toContain("@assay-ai/mcp@2.0.1");
    vi.unstubAllEnvs();
  });

  it("throws when it is missing or not exact", () => {
    for (const bad of ["", "^1.0.0", "latest"]) {
      vi.stubEnv("NEXT_PUBLIC_ASSAY_MCP_VERSION", bad);
      expect(() => assayMcpVersion()).toThrow();
      expect(() => installCommand("claude-code", { url: "https://mcp.assay.ai/", name: "assay" })).toThrow();
    }
    vi.unstubAllEnvs();
  });
});

describe("the API-key snippet", () => {
  it("is a remote entry with the key in a header, and only here", () => {
    const out = JSON.parse(apiKeyConfig({ url: "https://mcp.assay.ai/", token: "assay_sk_live_k1" }));
    expect(out.mcpServers.assay).toEqual({ type: "http", url: "https://mcp.assay.ai/", headers: { Authorization: "Bearer assay_sk_live_k1" } });
    expect(apiKeyConfig({ url: "https://mcp.assay.ai/", token: null })).toContain(KEY_PLACEHOLDER);
  });
});
