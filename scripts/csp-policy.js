/**
 * Content-Security-Policy building blocks, shared by `next.config.js` (the
 * site-wide Report-Only policy `next dev` sends), `public/_headers` (checked
 * against `strictPolicy()` and `sitePolicy()` by
 * `src/config/security-headers.test.ts`) and `scripts/connect-csp.js` (which
 * completes both policies after the build).
 *
 * Privy's list: https://docs.privy.io/security/implementation-guide/content-security-policy
 */

/** Chain RPC origins (exact): `src/config/strict-rpc-origins.json`, also read by `src/features/delegation/enable-paid.ts`. */
const STRICT_RPC_ORIGINS = require("../src/config/strict-rpc-origins.json");

/** Frames Privy opens: its auth iframe, WalletConnect verification, Turnstile. */
const PRIVY_FRAMES = [
  "https://auth.privy.io",
  // Privy's HttpOnly-cookie domain: with cookies on, the SDK talks to it instead of auth.privy.io.
  "https://privy.goassay.ai",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://challenges.cloudflare.com",
];

/**
 * Script origins the strict pages allow besides their own: Cloudflare Turnstile,
 * which the Privy SDK loads on every page once the app has its captcha on.
 * challenges.cloudflare.com serves only Cloudflare's own scripts.
 */
const STRICT_SCRIPT_ORIGINS = ["https://challenges.cloudflare.com"];

/** Origins the app fetches from besides its own API: Privy, WalletConnect, and the chains' RPCs. */
const CONNECT_ORIGINS = [
  "https://auth.privy.io",
  "https://privy.goassay.ai",
  "https://*.rpc.privy.systems",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://www.walletlink.org",
  "https://explorer-api.walletconnect.com",
  "https://pulse.walletconnect.org",
  "https://api.web3modal.org",
  // The chains' RPCs, exact origins: one list, shared with the enable-paid page's "Add funds".
  ...STRICT_RPC_ORIGINS,
  "https://*.solana.com",
];

/**
 * Origins only the site-wide policy adds to `connect-src`: the Solana
 * subscription socket (`createSolanaRpcSubscriptions`, `wss://api.devnet.solana.com`),
 * which the Solana signing path opens. Kept out of `CONNECT_ORIGINS` so the
 * enforced strict policy stays exactly as it is.
 */
const SITE_CONNECT_ORIGINS = ["wss://*.solana.com"];

/** The `_headers` block that carries `sitePolicy()`, and the header it is sent as. */
const SITE_PATH = "/*";
const SITE_HEADER = "Content-Security-Policy-Report-Only";

/** The pages that get the strict policy (spec R-WEB-2): `_headers` path patterns. */
const STRICT_PATHS = ["/connect/*", "/agents/enable-paid"];

/**
 * The strict policy of spec R-WEB-2 for `/connect/*` and `/agents/enable-paid`:
 * `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none';
 * form-action 'self'`, plus only the Privy and RPC origins in `connect-src` and
 * `frame-src`.
 *
 * Two additions the build makes, and nothing else:
 * - `scriptHashes`: the SHA-256 of each inline `<script>` the static export
 *   wrote into those pages (Next's own bootstrap and flight data, and the
 *   pre-paint theme script). Without them `script-src 'self'` stops the page
 *   from ever starting. A hash allows exactly that script text, never another;
 * - `connectOrigins`: the app's own API origin, which the pages call.
 *
 * `style-src` keeps `'unsafe-inline'`: React writes `style` attributes and
 * Privy injects its stylesheet. A style cannot run code.
 */
function strictPolicy({ scriptHashes = [], connectOrigins = [] } = {}) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...STRICT_SCRIPT_ORIGINS, ...scriptHashes.map((hash) => `'sha256-${hash}'`)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${PRIVY_FRAMES.join(" ")}`,
    ["connect-src 'self'", ...connectOrigins, ...CONNECT_ORIGINS].join(" "),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

/**
 * The catch-all for a splat (`/connect/*`) in the built `out/_headers`, for a
 * response under it that has no block of its own (the 404 page, a page the
 * build step did not see). Cloudflare Pages sends it together with the page's
 * own policy, and a browser enforces both, so it can only narrow:
 * - scripts: this origin plus the hashes of every page under the splat, so an
 *   unknown inline script is refused there too;
 * - every other directive of `strictPolicy()` except the two long origin lists
 *   (`connect-src`, `frame-src`) and `default-src`, which would fall back onto
 *   them and refuse the API on every page. Those two stay in each page's own
 *   policy. Both lists would not fit Cloudflare's 2,000-character line.
 */
function fallbackPolicy({ scriptHashes = [] } = {}) {
  return [
    ["script-src 'self'", ...STRICT_SCRIPT_ORIGINS, ...scriptHashes.map((hash) => `'sha256-${hash}'`)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

/**
 * The site-wide policy (security checklist P12), for every page but the
 * strict ones, which detach it in `public/_headers` and keep their enforced
 * `strictPolicy()`. Sent as `Content-Security-Policy-Report-Only` first, so a
 * missed origin shows up as a console report and never breaks sign-in;
 * promote it to an enforced header once production reports are clean. There
 * is no report endpoint (no `report-uri`/`report-to`): violations go to the
 * browser console only.
 *
 * - `connectOrigins`: the API and MCP origins of the build's environment
 *   (`NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_MCP_URL`), added by
 *   `scripts/connect-csp.js` (production) and `next.config.js` (next dev).
 * - `dev`: `next dev` evaluates code (React refresh), so `'unsafe-eval'`
 *   there only; a production build never has it.
 *
 * `script-src` keeps `'unsafe-inline'`, unlike the strict pages: a static
 * export has no per-request nonce, and hashes are per page (Next writes its
 * bootstrap and flight data as 12-22 different inline scripts per page). That
 * means one `_headers` block per exported page (83 today, against Cloudflare
 * Pages' 100-rule limit) and a line of about 2,300 characters for the largest
 * page (against the 2,000-character limit). `style-src` keeps it for the same
 * reason as `strictPolicy()`: React `style` attributes and Privy's injected
 * stylesheet.
 *
 * `frame-ancestors 'self'` and `base-uri 'self'`: the same framing the enforced
 * site-wide header allows (the app frames itself in the narrow-viewport checks).
 */
function sitePolicy({ connectOrigins = [], dev = false } = {}) {
  return [
    "default-src 'self'",
    ["script-src 'self' 'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...STRICT_SCRIPT_ORIGINS].join(" "),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `child-src ${PRIVY_FRAMES.join(" ")}`,
    `frame-src ${PRIVY_FRAMES.join(" ")}`,
    ["connect-src 'self'", ...connectOrigins, ...CONNECT_ORIGINS, ...SITE_CONNECT_ORIGINS].join(" "),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join("; ");
}

/** The origins of the URLs given (the build's API and MCP URLs), skipping unset or invalid ones and repeats. */
function originsOf(...values) {
  const origins = [];
  for (const value of values) {
    try {
      const origin = value ? new URL(value).origin : null;
      if (origin && origin !== "null" && !origins.includes(origin)) origins.push(origin);
    } catch {}
  }
  return origins;
}

module.exports = {
  PRIVY_FRAMES,
  CONNECT_ORIGINS,
  SITE_CONNECT_ORIGINS,
  SITE_PATH,
  SITE_HEADER,
  STRICT_SCRIPT_ORIGINS,
  STRICT_RPC_ORIGINS,
  STRICT_PATHS,
  strictPolicy,
  fallbackPolicy,
  sitePolicy,
  originsOf,
};
