import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

/* Frontend review 2026-10-15, F2: the headers `next.config.js` serves on every route. */
const require = createRequire(import.meta.url);

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
