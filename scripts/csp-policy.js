/**
 * Content-Security-Policy building blocks, shared by `next.config.js` (the
 * site-wide Report-Only policy `next dev` sends), `public/_headers` (checked
 * against `strictPolicy()` by `src/config/security-headers.test.ts`) and
 * `scripts/connect-csp.js` (which completes the strict policy after the build).
 *
 * Privy's list: https://docs.privy.io/security/implementation-guide/content-security-policy
 */

/** Frames Privy opens: its auth iframe, WalletConnect verification, Turnstile. */
const PRIVY_FRAMES = [
  "https://auth.privy.io",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://challenges.cloudflare.com",
];

/** Origins the app fetches from besides its own API: Privy, WalletConnect, and the chains' RPCs. */
const CONNECT_ORIGINS = [
  "https://auth.privy.io",
  "https://*.rpc.privy.systems",
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://www.walletlink.org",
  "https://explorer-api.walletconnect.com",
  "https://pulse.walletconnect.org",
  "https://api.web3modal.org",
  "https://rpc.testnet.chain.robinhood.com",
  "https://*.solana.com",
];

/** The pages that get the strict policy (spec R-WEB-2): `_headers` path patterns. */
const STRICT_PATHS = ["/connect/*", "/agents/enable-paid"];

/**
 * The strict policy of spec R-WEB-2 for `/connect/*` and `/agents/enable-paid`:
 * `default-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none';
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
    ["script-src 'self'", ...scriptHashes.map((hash) => `'sha256-${hash}'`)].join(" "),
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

module.exports = { PRIVY_FRAMES, CONNECT_ORIGINS, STRICT_PATHS, strictPolicy };
