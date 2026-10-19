import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

/* Frontend review 2026-10-15, F2: the headers `next.config.js` serves on every route. */
const require = createRequire(import.meta.url);
// next.config.js refuses to load without the MCP host (and the pinned version).
process.env.NEXT_PUBLIC_MCP_URL ??= "https://mcp.example.com/";
process.env.NEXT_PUBLIC_ASSAY_MCP_VERSION ??= "1.2.3";

async function headersFor(nodeEnv: string): Promise<Record<string, string>> {
  const previous = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = nodeEnv;
  try {
    const path = require.resolve("../../next.config.js");
    delete require.cache[path];
    const config = require(path) as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const [rule] = await config.headers();
    expect(rule.source).toBe("/:path*");
    return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
  } finally {
    (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
  }
}

describe("security headers", () => {
  it("refuses framing and sniffing, trims the referrer and drops device permissions", async () => {
    const headers = await headersFor("development");
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
    expect(headers["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("https://auth.privy.io");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS in production only", async () => {
    // Production is a static export: next.config sends nothing there, and
    // Cloudflare Pages serves `public/_headers` instead. Its `/*` block must be
    // exactly the enforced set next dev sends, plus HSTS.
    const text = (await import("node:fs")).readFileSync(require.resolve("../../public/_headers"), "utf8");
    const all: Record<string, string> = {};
    let inAll = false;
    for (const line of text.split("\n")) {
      if (/^\S/.test(line)) inAll = line.trim() === "/*";
      else if (inAll && line.includes(":")) {
        const i = line.indexOf(":");
        all[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    }
    const dev = await headersFor("development");
    const enforced = Object.fromEntries(
      Object.entries(dev).filter(([key]) => key !== "Content-Security-Policy-Report-Only"),
    );
    const { "Strict-Transport-Security": hsts, ...rest } = all;
    expect(rest).toEqual(enforced);
    expect(hsts).toMatch(/^max-age=\d+/);
    expect(dev["Strict-Transport-Security"]).toBeUndefined();

    // And next.config sends nothing in production, where it could not anyway.
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const path = require.resolve("../../next.config.js");
      delete require.cache[path];
      expect((require(path) as { headers?: unknown }).headers).toBeUndefined();
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
    }
  });
});

/* Spec R-WEB-2 and R-WEB-4: the consent and enable-paid pages. */
const csp = require("../../scripts/csp-policy.js") as {
  PRIVY_FRAMES: string[];
  CONNECT_ORIGINS: string[];
  STRICT_PATHS: string[];
  strictPolicy: (options?: { scriptHashes?: string[]; connectOrigins?: string[] }) => string;
  fallbackPolicy: (options?: { scriptHashes?: string[] }) => string;
};
const connectCsp = require("../../scripts/connect-csp.js") as {
  completeHeaders: (text: string, pages: Record<string, Record<string, string>>, connectOrigins: string[]) => string;
  inlineScriptHashes: (html: string) => Set<string>;
  SPLAT_HEADERS: Record<string, Record<string, string>>;
};

async function headersFile(): Promise<string> {
  return (await import("node:fs")).readFileSync(require.resolve("../../public/_headers"), "utf8");
}

/** The headers of one `_headers` block, by its exact path line. */
function block(text: string, path: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let inside = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inside = line.trim() === path;
    else if (inside && line.includes(":")) {
      const i = line.indexOf(":");
      headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return headers;
}

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")];
    }),
  );

describe("strict pages: /connect/* and /agents/enable-paid", () => {
  it("_headers /connect/* has frame-ancestors 'none', X-Frame-Options DENY, Referrer-Policy no-referrer", async () => {
    const text = await headersFile();
    expect(csp.STRICT_PATHS).toEqual(["/connect/*", "/agents/enable-paid"]);
    for (const path of csp.STRICT_PATHS) {
      const headers = block(text, path);
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["Referrer-Policy"]).toBe("no-referrer");
      expect(headers["Content-Security-Policy"]).toBe(csp.strictPolicy());
      const policy = directives(headers["Content-Security-Policy"]);
      expect(policy["frame-ancestors"]).toBe("'none'");
      expect(policy["default-src"]).toBe("'self'");
      expect(policy["script-src"]).toBe("'self'");
      expect(policy["base-uri"]).toBe("'none'");
      expect(policy["form-action"]).toBe("'self'");
      expect(policy["object-src"]).toBe("'none'");
      expect(policy["frame-src"]).toBe(csp.PRIVY_FRAMES.join(" "));
      expect(policy["connect-src"]).toBe(["'self'", ...csp.CONNECT_ORIGINS].join(" "));
      expect(headers["Content-Security-Policy"]).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    }
  });

  it("next dev refuses framing and the referrer on those pages too", async () => {
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "development";
    try {
      const path = require.resolve("../../next.config.js");
      delete require.cache[path];
      const config = require(path) as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
      const rules = await config.headers();
      for (const source of ["/connect/:path+", "/agents/enable-paid"]) {
        const rule = rules.find((r) => r.source === source);
        expect(Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))).toEqual({
          "Content-Security-Policy": "frame-ancestors 'none'",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
        });
        // After the site-wide rule, so these win for the same keys.
        expect(rules.indexOf(rule!)).toBeGreaterThan(rules.findIndex((r) => r.source === "/:path*"));
      }
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
    }
  });
});

describe("scripts/connect-csp.js", () => {
  const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
  const page = (...scripts: string[]) =>
    `<html><head><script src="/_next/static/a.js" async=""></script>${scripts.map((s) => `<script>${s}</script>`).join("")}<script></script></head></html>`;

  it("hashes each inline script, never an external one or an empty one", () => {
    expect([...connectCsp.inlineScriptHashes(page("a()", "b()", "a()"))].sort()).toEqual([sha("a()"), sha("b()")].sort());
  });

  it("gives each /connect page its own block with only its hashes, and completes exact paths in place", async () => {
    const text = await headersFile();
    const out = connectCsp.completeHeaders(
      text,
      {
        "/connect/*": { "/connect/authorize": page("one()"), "/connect/authorize-error": page("two()") },
        "/agents/enable-paid": { "/agents/enable-paid": page("three()") },
      },
      ["https://api.example.com"],
    );
    // The splat keeps a catch-all policy with every page's hashes, and the frame and referrer refusals.
    expect(block(out, "/connect/*")).toEqual({
      "Content-Security-Policy": csp.fallbackPolicy({ scriptHashes: [sha("one()"), sha("two()")].sort() }),
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    const fallback = directives(block(out, "/connect/*")["Content-Security-Policy"]);
    expect(fallback["frame-ancestors"]).toBe("'none'");
    expect(fallback["object-src"]).toBe("'none'");
    expect(fallback["base-uri"]).toBe("'none'");
    expect(fallback["form-action"]).toBe("'self'");
    expect(fallback["script-src"]).toBe(["'self'", ...[sha("one()"), sha("two()")].sort().map((h) => `'sha256-${h}'`)].join(" "));
    // No default-src there: it would fall back onto connect-src and refuse the API on every page.
    expect(fallback["default-src"]).toBeUndefined();
    expect(block(out, "/connect/authorize")["Content-Security-Policy"]).toBe(
      csp.strictPolicy({ scriptHashes: [sha("one()")], connectOrigins: ["https://api.example.com"] }),
    );
    expect(block(out, "/connect/authorize-error")["Content-Security-Policy"]).toBe(
      csp.strictPolicy({ scriptHashes: [sha("two()")], connectOrigins: ["https://api.example.com"] }),
    );
    expect(block(out, "/agents/enable-paid")).toEqual({
      "Content-Security-Policy": csp.strictPolicy({ scriptHashes: [sha("three()")], connectOrigins: ["https://api.example.com"] }),
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    });
    // The site-wide block is untouched.
    expect(block(out, "/*")).toEqual(block(text, "/*"));
  });

  it("keeps Cross-Origin-Opener-Policy same-origin-allow-popups on /connect/*, once, never in a per-page block (R1-m4)", async () => {
    const text = await headersFile();
    expect(block(text, "/connect/*")["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(connectCsp.SPLAT_HEADERS).toEqual({
      "/connect/*": { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" },
      "/agents/enable-paid": { "Cross-Origin-Opener-Policy": "same-origin-allow-popups" },
    });
    const out = connectCsp.completeHeaders(
      text,
      { "/connect/*": { "/connect/authorize": page("one()"), "/connect/authorize-error": page("two()") } },
      [],
    );
    // Every /connect page matches the splat's block too, so it gets the header from there, once:
    // Cloudflare Pages would join a repeat by comma, a value browsers ignore.
    expect(out.match(/^\s+Cross-Origin-Opener-Policy:.*$/gm)).toEqual([
      "  Cross-Origin-Opener-Policy: same-origin-allow-popups",
      "  Cross-Origin-Opener-Policy: same-origin-allow-popups",
    ]);
    expect(block(out, "/agents/enable-paid")["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(block(out, "/connect/*")["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(block(out, "/connect/authorize")["Cross-Origin-Opener-Policy"]).toBeUndefined();
    expect(block(out, "/*")["Cross-Origin-Opener-Policy"]).toBeUndefined();
  });

  it("fails the build when /connect/* lacks that header, weakens it, or another block repeats it", async () => {
    const text = await headersFile();
    const line = "  Cross-Origin-Opener-Policy: same-origin-allow-popups\n";
    expect(text).toContain(line);
    expect(() => connectCsp.completeHeaders(text.replace(line, ""), {}, [])).toThrow(/needs exactly one "Cross-Origin-Opener-Policy/);
    expect(() =>
      connectCsp.completeHeaders(text.replace(line, "  Cross-Origin-Opener-Policy: unsafe-none\n"), {}, []),
    ).toThrow(/needs exactly one/);
    // Plain same-origin would sever the page's own Privy and wallet popups.
    expect(() =>
      connectCsp.completeHeaders(text.replace(line, "  Cross-Origin-Opener-Policy: same-origin\n"), {}, []),
    ).toThrow(/needs exactly one/);
    expect(() => connectCsp.completeHeaders(text.replace(line, line + line), {}, [])).toThrow(/needs exactly one/);
    expect(() =>
      connectCsp.completeHeaders(text.replace("  X-Content-Type-Options: nosniff\n", `  X-Content-Type-Options: nosniff\n${line}`), {}, []),
    ).toThrow(/only \/connect\/\*, \/agents\/enable-paid may set it, not \/\*/);
    // …and the enable-paid block needs its own.
    const paid = text.indexOf("/agents/enable-paid\n");
    const withoutPaid = text.slice(0, paid) + text.slice(paid).replace(line, "");
    expect(() => connectCsp.completeHeaders(withoutPaid, {}, [])).toThrow(/\/agents\/enable-paid: needs exactly one/);
  });

  it("refuses a strict page that loads a script from another origin", async () => {
    const text = await headersFile();
    for (const src of ["https://cdn.example.com/a.js", "//cdn.example.com/a.js"]) {
      expect(() =>
        connectCsp.completeHeaders(text, { "/connect/*": { "/connect/authorize": `<script src="${src}"></script>` } }, []),
      ).toThrow(/outside this origin/);
    }
  });

  it("leaves a path with no pages yet at the bare policy", async () => {
    const text = await headersFile();
    const out = connectCsp.completeHeaders(text, { "/connect/*": { "/connect/authorize": page("x()") } }, []);
    expect(block(out, "/agents/enable-paid")["Content-Security-Policy"]).toBe(csp.strictPolicy());
  });

  it("refuses a policy that is not strictPolicy(), and a line over Cloudflare's limit", async () => {
    const text = await headersFile();
    expect(() =>
      connectCsp.completeHeaders(text.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"), {}, []),
    ).toThrow(/not strictPolicy/);
    const many = Array.from({ length: 40 }, (_, i) => `s${i}()`);
    expect(() =>
      connectCsp.completeHeaders(text, { "/connect/*": { "/connect/authorize": page(...many) } }, []),
    ).toThrow(/over 2000/);
  });
});

/* Fix round 2 (R2): a stray comment line once read as a rule path. */
describe("_headers is well formed", () => {
  const rulePathsOk = (text: string) => {
    for (const line of text.split("\n")) {
      if (!line.trim() || line.startsWith("#") || /^\s/.test(line)) continue;
      expect(line, `rule line ${JSON.stringify(line)}`).toMatch(/^\/\S*$/);
    }
  };

  it("every rule line of public/_headers is one path, with no space", async () => {
    rulePathsOk(await headersFile());
  });

  it("and so is every rule line the build writes", async () => {
    const text = await headersFile();
    rulePathsOk(
      connectCsp.completeHeaders(
        text,
        {
          "/connect/*": { "/connect/authorize": "<script>a()</script>", "/connect/authorize-error": "<script>b()</script>" },
          "/agents/enable-paid": { "/agents/enable-paid": "<script>c()</script>" },
        },
        ["https://api.example.com"],
      ),
    );
  });
});
