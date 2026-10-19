# assay-frontend

The web app for GoAssay.AI: a pay-per-call payment layer, built on the x402
payment protocol, for AI agents and the paid APIs (tools) they call, settled in USDC on Solana and on
EVM chains (currently the Robinhood Chain testnet, `eip155:46630`).

It contains:

- **Buyer app** (`src/app/(main)`) — onboarding, funding and per-buyer escrow,
  spend limits, receipts, statements, alerts, agents and team management.
- **Provider console** (`src/app/(console)/provider`) — registration, tool
  bindings, stake, verdicts, disputes, slash cases, payouts and traffic.
- **Operator console** (`src/app/(operator)`) — internal review and approval
  screens for platform operators.
- **Public pages** (`src/app/(public)`) — how it works, catalogue, calculator,
  proof of reserves, and a demo.

## Status

Experimental and under active development. It has run against Solana devnet
and an EVM testnet only; it is not production-ready. The on-chain programs it
talks to have been internally reviewed but **not independently audited**.
Expect breaking changes.

## Related repositories

This app is one of four repositories:

| Repository              | What it is                                         |
| ----------------------- | -------------------------------------------------- |
| assay-frontend        | This web app                                       |
| assay-backend         | NestJS API the app talks to (`NEXT_PUBLIC_API_BASE_URL`) |
| assay-solana        | Solana (Anchor) settlement program                 |
| assay-evm             | EVM (Foundry) settlement contracts                 |

Most screens need a running backend to show data. For a look around without
a seeded backend, build with `NEXT_PUBLIC_DEMO_CHAINS=robinhood`, which fills
empty or failed reads from built-in fixtures.

## Requirements

- Node.js 22 or newer (`check:headers` needs it)
- pnpm 10 (the version is pinned in `package.json` → `packageManager`). With
  Corepack: `corepack enable`. Without it: `npx -y pnpm@10 <command>`.
- A [Privy](https://www.privy.io) app id for sign-in (any 25-character
  placeholder is enough to build, but sign-in needs a real app).

## Quick start

```bash
git clone <this repository> assay-frontend
cd assay-frontend
pnpm install --frozen-lockfile
cp .env.local.example .env.local      # then edit the values
pnpm dev --port 4000
```

Open <http://localhost:4000>. The app expects the backend API at the URL in
`NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:3000/api/v1`). Keep the
port in sync with `NEXT_PUBLIC_BASE_URL`, because absolute URLs are built from
it.

The app is a **static export**: `pnpm build` writes plain files to `out/`, and
deployment uploads them to Cloudflare Pages from GitHub Actions. See
[DEPLOY.md](DEPLOY.md), which also shows how to serve `out/` locally.

### Environment variables

All variables are `NEXT_PUBLIC_*`, which means they are **inlined into the
browser bundle at build time**: never put a secret in them, and rebuild after
changing them. See `.env.local.example` for the full list and comments.

| Variable                   | Required | Purpose                                         |
| -------------------------- | -------- | ----------------------------------------------- |
| `NEXT_PUBLIC_BASE_URL`     | yes      | Absolute URL this app is served from            |
| `NEXT_PUBLIC_API_BASE_URL` | yes      | Backend API base URL                            |
| `NEXT_PUBLIC_PRIVY_APP_ID` | yes      | Privy app id (must be 25 characters)            |
| `NEXT_PUBLIC_MCP_URL`      | yes      | Public URL of the MCP host, e.g. `https://mcp.assay.ai/`; without it the Connect page shows no command |
| `NEXT_PUBLIC_ASSAY_MCP_VERSION` | yes | Exact `@assay-ai/mcp` version every install command pins (no range, no tag); the build fails without it |
| `NEXT_PUBLIC_DEMO_CHAINS`  | no       | `robinhood` enables demo fixture data (never on a live deployment) |

## Scripts

| Command                | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `pnpm dev`             | Development server (Turbopack)                      |
| `pnpm build`           | Static export to `out/` (see DEPLOY.md)             |
| `pnpm lint`            | ESLint                                              |
| `pnpm typecheck`       | `next typegen` + `tsc --noEmit` (covers test files, which `next build` does not) |
| `pnpm test`            | Unit tests (Vitest)                                 |
| `pnpm check:tokens`    | Checks design tokens against the `cn()` merge config |
| `pnpm check:refusals`  | Compares gas-grant refusal reasons with a backend checkout (needs `ASSAY_BACKEND_SRC`) |

## Docker

Not used by the Cloudflare Pages deployment, and out of date: the image runs
`next start`, which a static export does not support.

```bash
docker build \
  --build-arg NEXT_PUBLIC_BASE_URL=https://app.example.com \
  --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com/api/v1 \
  --build-arg NEXT_PUBLIC_PRIVY_APP_ID=<your-privy-app-id> \
  --build-arg NEXT_PUBLIC_ASSAY_MCP_VERSION=<exact-version> \
  --build-arg NEXT_PUBLIC_MCP_URL=<mcp-host-url> \
  -t assay-frontend .
docker run -p 3000:3000 assay-frontend
```

The image serves on port 3000 (the Next.js default; `pnpm start --port 4000` in
the quick start is a separate local setup). `NEXT_PUBLIC_BASE_URL` is inlined
at build time, so it must match the URL the app is published at, including the
port.

## Repository layout

```
src/
├── app/          # Next.js App Router routes, grouped by audience
├── components/   # ui/ (primitives; some derived from shadcn/ui), layout/, icons/, shared components
├── features/     # feature-level logic and view models, grouped by domain
├── hooks/        # React hooks
├── interfaces/   # TypeScript types for the backend API
├── libs/         # API client, chain adapters (libs/chains/), demo fixtures
├── providers/    # React context providers
├── services/     # One API service module per backend domain
├── styles/       # Global styles and design tokens (CSS custom properties)
└── utils/        # Pure helpers
scripts/          # Repo maintenance scripts (icons, token parity, refusal check)
```

Chain SDKs (`@solana/*`, `viem`, …) may only be imported under
`src/libs/chains/`; ESLint enforces this.

## Contributing

External code contributions are not accepted at this time; bug reports and
discussion are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report
security issues as described in [SECURITY.md](SECURITY.md), and follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Acknowledgements

Some UI primitives in `src/components/ui/` are derived from
[shadcn/ui](https://ui.shadcn.com) (MIT, text in `licenses/`); the rest of that
directory is first-party. Fonts (Funnel Sans, JetBrains Mono) are loaded from
Google Fonts via `next/font` and are licensed under the SIL Open Font License
1.1; the build needs network access to Google Fonts. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), which also names the
transitive packages under non-OSI licences (Reown/WalletConnect, MetaMask SDK).

## License

Source-available, not open source. You may read it and use it for
noncommercial purposes under the [PolyForm Strict License 1.0.0](LICENSE);
redistribution, modification and commercial use are not permitted. Questions
and licensing enquiries: open an issue or start a discussion in this
repository's GitHub Issues/Discussions. Security reports go through GitHub
private vulnerability reporting, as described in [SECURITY.md](SECURITY.md).

The PolyForm licence applies to first-party code only. Third-party
dependencies and components (for example shadcn/ui-derived components and the
Google Fonts listed above; see THIRD_PARTY_NOTICES.md) keep their own licences.
