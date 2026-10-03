# Contributing

Thanks for your interest in assay-frontend.

**External code contributions are not accepted at this time.** The code is
published under the PolyForm Strict License 1.0.0 (see [LICENSE](LICENSE)),
which does not permit modified or derivative versions, so pull requests from
outside the project cannot be merged. Bug reports, questions and discussion are
welcome: please open a GitHub issue.

The rest of this guide explains how to build and run the code locally and how
the codebase is organised, for anyone reading it or reporting a problem.

## Setup

Requirements: Node.js 20+, pnpm 10 (pinned in `package.json`; use
`corepack enable`, or prefix commands with `npx -y pnpm@10`).

```bash
pnpm install --frozen-lockfile    # also installs the git hooks (husky)
cp .env.local.example .env.local  # required before the first build
pnpm build && pnpm start --port 4000
```

`.env.local` is required: without a 25-character `NEXT_PUBLIC_PRIVY_APP_ID`
the build compiles and type-checks, then fails during page generation with
"Cannot initialize the Privy provider with an invalid Privy app ID".

Port 4000 matters because `NEXT_PUBLIC_BASE_URL` is what every absolute URL is
built from, and the backend API uses 3000 by default. `pnpm dev --port 4000`
gives you hot reload; `build` + `start` uses far less memory. If you use
`start`, a source edit is invisible until you rebuild and restart, and the
browser may keep running the previous build's chunks, so load the page with a
fresh query string after a rebuild.

## Checks

CI runs these checks; they are also the quickest way to confirm a local setup works:

```bash
pnpm lint        # ESLint 9 flat config (eslint.config.mjs)
pnpm typecheck   # tsc --noEmit — required separately: next build does not type-check test files
pnpm test        # Vitest
pnpm build
```

The `pre-push` git hook runs `pnpm typecheck` (which first generates `next-env.d.ts` and route types with `next typegen`; plain `tsc` fails on a fresh clone without them).

Tests run in a Node environment by default. A test that needs the DOM can opt
in with `// @vitest-environment jsdom` at the top of its file.

## Architecture

```
src/
├── app/          # App Router: routes, layouts, pages only
├── components/
│   ├── ui/       # UI primitives only (no feature components)
│   ├── common/   # shared non-UI components
│   ├── icons/    # SVG icons + generated index.tsx
│   └── layout/   # app shell
├── features/     # feature logic and view models, grouped by domain
├── hooks/        # one hook per file, named use*.ts(x)
├── interfaces/   # TypeScript types by domain, re-exported from index.ts
├── libs/         # library configs and wrappers; chain SDK code in libs/chains/
├── providers/    # React context providers, composed in providers/index.tsx
├── services/     # API service functions, one file per backend domain
├── styles/       # globals.scss, theme.scss (design tokens)
└── utils/        # pure utility functions
```

Path alias: `@/*` → `src/*`.

| What             | Where                                                          |
| ---------------- | -------------------------------------------------------------- |
| Page / route     | `src/app/`                                                     |
| Shared component | `src/components/common/`                                       |
| UI primitive     | `src/components/ui/`                                           |
| Icon             | add the `.svg` to `src/components/icons/`, then run `node scripts/update-icons.js && node scripts/generate-icons.js` (never edit `icons/index.tsx` by hand) |
| Type             | `src/interfaces/<domain>.ts`, re-exported from `index.ts`      |
| API service      | `src/services/<domain>.service.ts`, re-exported from `index.ts` |

### Rules worth knowing

- **Chain SDKs stay behind `src/libs/chains/`.** `@solana/*`, `@solana-program/*`,
  `viem` and similar may only be imported there; `pnpm lint` fails
  otherwise. Screens talk to chains through that layer.
- **Services** use the shared `ApiClient` (`src/libs/ApiClient.ts`) and return
  types from `src/interfaces/`. API errors are handled centrally in the client's
  interceptors; do not re-catch them in components.
- **Money** is carried as minor units in strings and computed with
  `decimal.js` — never as a JavaScript float.
- **Styling** uses Tailwind with the design tokens in `tailwind.config.js` and
  `src/styles/theme.scss`. Do not hardcode colors, spacing or font sizes. When
  you add a token, run `pnpm check:tokens`: `cn()` (tailwind-merge) must be told
  about custom token names, or it silently drops them.
- **Server Components by default**; add `"use client"` only when a component
  needs hooks, event handlers or browser APIs.
- User-facing errors go through the Sonner toast helper in `src/utils/toast.ts`.

### Naming

- Files and directories: kebab-case (`user-profile.ts`)
- Components and classes: PascalCase
- Variables and functions: camelCase
- Constants and enum members: UPPER_SNAKE_CASE

Match the existing formatting: double quotes in TS/TSX, trailing commas,
2-space indent, lines of about 100 characters.

## Reporting bugs and security issues

Open a GitHub issue for bugs. For security issues, follow
[SECURITY.md](SECURITY.md) instead of filing a public issue.
