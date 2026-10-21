import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * The frontend's ESLint config.
 *
 * Until this file existed `pnpm lint` was `next lint` — a command Next removed
 * in v16 — so it exited 1 by parsing `lint` as a directory, and no rule of any
 * kind ran over `src/`: `next build` type-checks, and that is all it did.
 *
 * `eslint-config-next/core-web-vitals` already pulls in `next/typescript`
 * (verified: the exported array is `['next', 'next/typescript', {ignores},
 * 'next/core-web-vitals']`), so both recommended sets are one import and no
 * new dependency.
 */

/**
 * The boundary this config exists for.
 *
 * `src/libs/chains/` is the ONLY directory permitted to import a chain SDK.
 * The backend (assay-backend) enforces the identical rule
 * (`CHAIN_SDK_BAN` in its ESLint config) for the identical reason: without it, "add EVM" touches
 * every screen, and the first `@solana/kit` import inside a component is the
 * moment the abstraction stops being one.
 *
 * `viem`, `wagmi`, `ethers` and `web3` are named even though NONE of them is a
 * dependency today. That is deliberate: the rule has to already be in place
 * on the day somebody adds one, because the natural place to write the first
 * `viem` import is the screen that needs it.
 *
 * Patterns are gitignore-style, so a bare `web3` would match a path segment
 * called `web3`. There is no such segment in this repo today; keep the list
 * exact rather than broadening it.
 */
const CHAIN_SDK_PACKAGES = [
  "@solana/*",
  "@solana-program/*",
  "@coral-xyz/*",
  "@x402/settlement-client",
  "viem",
  "wagmi",
  "ethers",
  "web3",
];

const CHAIN_SDK_MESSAGE =
  "Chain SDKs belong in src/libs/chains/. Reach the chain through a hook or a service instead.";

/**
 * Rules that fire on code that predates this config.
 *
 * Measured when the config was introduced, over 304 files in src/: 16 errors
 * across six rules and 5 warnings across two, all in pre-existing code.
 * Turning them into blocking errors would have meant rewriting four hooks, a
 * mapping editor and two layout bars in the same change, burying the
 * boundary rule that is the actual point.
 *
 * So they are `warn`: visible on every run, blocking nothing, and countable —
 * a later cleanup is measured against the number below, not against a vibe.
 * The chain-SDK boundary below is `error`, and it is the only `error` this
 * config adds.
 *
 *   react-hooks/set-state-in-effect        3   use-guarantee, use-overview,
 *                                              useThemeSettings
 *   react/no-unescaped-entities            3   not-found, limits-view
 *   react-hooks/refs                       3   mapping-editor
 *   react-hooks/preserve-manual-memoization 1  limits-view
 *   react-hooks/globals                    1   useSigner.test.ts
 */
const PRE_EXISTING_ERRORS_DOWNGRADED = {
  "react-hooks/set-state-in-effect": "warn",
  "react/no-unescaped-entities": "warn",
  "react-hooks/refs": "warn",
  // NOT `@tanstack/query/exhaustive-deps`. That rule ships in
  // `@tanstack/eslint-plugin-query`, which is not a dependency of this repo
  // and is not bundled by `eslint-config-next` (its three config objects
  // declare react, react-hooks, import, jsx-a11y, @next/next and
  // @typescript-eslint, and nothing else). Naming a rule from an unloaded
  // plugin is not a no-op in flat config — ESLint exits 2 with "could not
  // find plugin", so the line would break `pnpm lint` outright rather than
  // downgrading anything. If the plugin is ever added, add the downgrade back
  // with it.
  "react-hooks/preserve-manual-memoization": "warn",
  "react-hooks/globals": "warn",
};

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "public/**",
      "next-env.d.ts",
      // Node scripts run outside the app's module graph and outside its
      // tsconfig; the backend ignores its own `scripts/**` for the same
      // reason. Anything here that matters is covered by `tsc --noEmit`.
      "scripts/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    name: "assay/pre-existing",
    rules: PRE_EXISTING_ERRORS_DOWNGRADED,
  },
  {
    name: "assay/chain-sdk-boundary",
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/libs/chains/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: CHAIN_SDK_PACKAGES, message: CHAIN_SDK_MESSAGE }],
        },
      ],
    },
  },
];
