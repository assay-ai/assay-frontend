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

/** The origin of a URL from the environment, or nothing when it is unset or not a URL. */
const originOf = (value) => {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
};

/**
 * Security headers (frontend review 2026-10-15, F2).
 *
 * Enforced: no framing anywhere (the signing pages could otherwise be
 * clickjacked, Privy's confirmation modal included), no MIME sniffing, a
 * referrer cut to the origin cross-site, and no camera, microphone or
 * geolocation. HSTS only in production, where the site is served over HTTPS.
 *
 * The full script/connect policy ships in Report-Only mode first: Privy, its
 * WalletConnect relay and the backend-served RPCs need their origins, and an
 * enforced policy that misses one breaks sign-in. Promote it once the reports
 * are clean. Privy's list: https://docs.privy.io/security/implementation-guide/content-security-policy
 */
const PRIVY_FRAMES = [
  "https://auth.privy.io",
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
  "https://challenges.cloudflare.com",
];
const REPORT_ONLY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"} https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `child-src ${PRIVY_FRAMES.join(" ")}`,
  `frame-src ${PRIVY_FRAMES.join(" ")}`,
  [
    "connect-src 'self'",
    originOf(process.env.NEXT_PUBLIC_API_BASE_URL),
    originOf(process.env.NEXT_PUBLIC_MCP_URL),
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
  ]
    .filter(Boolean)
    .join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_POLICY },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

module.exports = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
