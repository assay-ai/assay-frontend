/** @type {import('next').NextConfig} */
 const fs = require("fs");

const getLatestCommit = () => {
  try {
    const rev = fs.readFileSync(".git/HEAD").toString().trim();
    let buildId;

    if (rev.indexOf(":") === -1) {
      buildId = rev;
    } else {
      buildId = fs
        .readFileSync(`.git/${rev.substring(5)}`)
        .toString()
        .trim();
    }

    return buildId.substring(0, 8);
  } catch (error) {
    console.warn("Could not get git commit hash, falling back to timestamp");
    return Date.now().toString();
  }
};

/**
 * The pinned `@goassay-ai/mcp` version every install command carries (R-MCP-14).
 * Inlined at build time; the build fails when it is unset or not an exact
 * version, so an unpinned command can never ship.
 */
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/;
if (!EXACT_VERSION.test(process.env.NEXT_PUBLIC_ASSAY_MCP_VERSION || "")) {
  throw new Error("NEXT_PUBLIC_ASSAY_MCP_VERSION must be an exact version such as 1.0.0 (no range, no tag).");
}

/**
 * The MCP host every Connect snippet, connector URL and consent redirect is
 * built from. The build fails without it: a placeholder URL must never be
 * copyable, and the consent page only redirects to this origin. `https` is
 * required except on loopback (a local stack).
 */
const mcpUrlProblem = (() => {
  let url;
  try {
    url = new URL(process.env.NEXT_PUBLIC_MCP_URL || "");
  } catch {
    return "is not set or not a URL";
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  return "must be https (http only on localhost)";
})();
if (mcpUrlProblem) throw new Error(`NEXT_PUBLIC_MCP_URL ${mcpUrlProblem}, e.g. https://mcp.goassay.ai/`);

/**
 * Security headers (frontend review 2026-10-15, F2).
 *
 * Enforced: no framing by any other origin (the signing pages could otherwise
 * be clickjacked, Privy's confirmation modal included; the app may frame itself,
 * which the narrow-viewport checks use), no MIME sniffing, a
 * referrer cut to the origin cross-site, and no camera, microphone or
 * geolocation. HSTS only in production, where the site is served over HTTPS.
 *
 * The full site-wide policy (`sitePolicy()` in scripts/csp-policy.js, with the
 * API and MCP origins of this environment) ships in Report-Only mode first;
 * production gets the same policy from `public/_headers`, completed by
 * scripts/connect-csp.js.
 */
const { sitePolicy, originsOf } = require("./scripts/csp-policy");
const REPORT_ONLY_POLICY = sitePolicy({
  connectOrigins: originsOf(process.env.NEXT_PUBLIC_API_BASE_URL, process.env.NEXT_PUBLIC_MCP_URL),
  dev: process.env.NODE_ENV !== "production",
});

/**
 * The consent and enable-paid pages (spec R-WEB-4): no framing at all, not
 * even by the app itself, and no referrer. In production `public/_headers`
 * sends these plus the strict policy of R-WEB-2; `next dev` cannot run under
 * that policy (it needs inline and eval'd scripts), so here only these three,
 * which override the site-wide values for the same keys.
 */
const STRICT_PAGE_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_POLICY },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

module.exports = {
  // A static export: `next build` writes plain HTML/JS/CSS to `out/`, served
  // as-is from Cloudflare Pages (see .github/workflows/deploy.yml). Nothing
  // renders on a server, so there is no `next start`.
  output: "export",
  // No image optimisation server either.
  images: { unoptimized: true },
  // A static export sends no headers of its own: in production they come from
  // `public/_headers` (Cloudflare Pages), which carries the enforced set below.
  // `next dev` still serves them, so local runs behave the same.
  ...(process.env.NODE_ENV === "production"
    ? {}
    : {
        async headers() {
          return [
            { source: "/:path*", headers: SECURITY_HEADERS },
            { source: "/connect/:path+", headers: STRICT_PAGE_HEADERS },
            { source: "/agents/enable-paid", headers: STRICT_PAGE_HEADERS },
          ];
        },
      }),
  turbopack: {
    rules: {
      "*.svg": {
        loaders: ["@svgr/webpack"],
        as: "*.js",
      },
    },
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  env: {
    buildId: getLatestCommit(),
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
};
