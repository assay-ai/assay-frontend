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
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy-Report-Only"]).toContain("https://auth.privy.io");
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS in production only", async () => {
    // Production is a static export: next.config sends nothing there, and
    // Cloudflare Pages serves `public/_headers` instead.
    const config = (await import("node:fs")).readFileSync(
      require.resolve("../../public/_headers"),
      "utf8",
    );
    expect(config).toContain("Content-Security-Policy: frame-ancestors 'none'");
    expect(config).toContain("X-Frame-Options: DENY");
    expect(config).toContain("X-Content-Type-Options: nosniff");
    expect(config).toMatch(/Strict-Transport-Security: max-age=\d+/);
    expect((await headersFor("development"))["Strict-Transport-Security"]).toBeUndefined();
  });
});
