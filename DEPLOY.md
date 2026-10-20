# Deploying the app

The app is a static export: `next build` (`output: "export"` in
`next.config.js`) writes plain HTML, JS and CSS to `out/`. Nothing renders on a
server, so it is served from Cloudflare Pages. Record screens take their id in
the query string (`/receipts/view?id=…`, see `src/libs/routes.ts`) because a
static export cannot have run-time dynamic segments.

`.github/workflows/deploy.yml` builds and deploys on every push. Each branch
has its own GitHub environment and its own Cloudflare Pages project:

| Branch    | GitHub environment | Cloudflare Pages project |
| --------- | ------------------ | ------------------------ |
| `main`    | `production`       | the production project   |
| `develop` | `develop`          | the develop project      |
| `demo`    | `demo`             | the demo project         |

The `demo` branch serves the same app with the demo data layer on: every
screen answers from fixtures in the browser, so it needs no backend and no
sign-in. Update it by merging `develop` (or `main`) into `demo`; its pages are
sent with `X-Robots-Tag: noindex`.

Every deploy is a **production** deployment of its project, never a preview:
the workflow reads the project's production branch from the Cloudflare API and
deploys under that branch name, so the project's root `<project>.pages.dev`
and its custom domains always serve the latest push.

## One-time setup

### 1. Cloudflare Pages projects

Create two direct-upload Pages projects (the workflow uploads `out/`;
Cloudflare does not build), one per environment:

```sh
npx wrangler@4.147.0 pages project create <project>
```

Their production branch can be named anything; the workflow uses whatever it
is. Give each project its custom domain under **Custom domains**.

### 2. Cloudflare API token

Create an API token with **Account → Cloudflare Pages → Edit** for the account
that owns the projects.

### 3. GitHub environments

In the repository settings, create two environments, `develop` and
`production`. In each one set:

| Kind     | Name                       | Value                                           |
| -------- | -------------------------- | ----------------------------------------------- |
| Variable | `NEXT_PUBLIC_BASE_URL`     | the app's public URL, e.g. `https://app.example.com` |
| Variable | `NEXT_PUBLIC_API_BASE_URL` | the backend API, e.g. `https://api.example.com/api/v1` |
| Variable | `NEXT_PUBLIC_PRIVY_APP_ID` | the Privy app id (25 characters)                |
| Variable | `NEXT_PUBLIC_MCP_URL`      | the MCP host root, e.g. `https://mcp.assay.ai/`; required: without it the Connect page shows no command |
| Variable | `NEXT_PUBLIC_ASSAY_MCP_VERSION` | the exact `@goassay-ai/mcp` version install commands pin (no range, no tag); the build fails without it |
| Variable | `NEXT_PUBLIC_DEMO_CHAINS`  | `demo` environment only: `robinhood`. Leave it unset in the others; the workflow refuses it there |
| Variable | `NEXT_PUBLIC_SHOW_KITCHEN_SINK` | optional: `1` keeps `/kitchen-sink` in the build |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | this environment's Pages project name           |
| Secret   | `CLOUDFLARE_API_TOKEN`     | the token from step 2                           |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`    | the Cloudflare account id                       |

The workflow reads each value from the environment's Variables first and its
Secrets second, so either tab works. `NEXT_PUBLIC_*` values are inlined into
the JavaScript every visitor downloads, so they need no secrecy; as Variables
they stay readable in the run logs, as Secrets they are masked there. Changing one takes effect on the
next deploy, not before: re-run the workflow (it has a manual
`workflow_dispatch` trigger) after editing them.

Optionally, protect `production` with required reviewers so a push to `main`
waits for approval before it deploys. The workflow has two jobs bound to the
environment, `build` (reads the `NEXT_PUBLIC_*` values, never the Cloudflare
credentials) and `deploy` (the only job that reads `CLOUDFLARE_API_TOKEN`), so
a reviewer approves each of them in turn.

`deploy` runs the wrangler pinned in `deploy/wrangler` (`package.json` and
`package-lock.json`, installed with `npm ci --ignore-scripts`). To bump it,
change the version there and regenerate the lockfile with
`npm install --package-lock-only --ignore-scripts` in that folder.

### 4. Privy allowed origins

In the Privy dashboard, add every origin the app is served from to the app's
allowed origins: each project's custom domain and its
`https://<project>.pages.dev`. An origin Privy does not allow leaves
the sign-in page waiting on "Checking your session".

### 5. Backend

The API must accept requests from every origin the app is served from. In
production `assay-backend` requires `CORS_ALLOWED_ORIGINS`: the API and the
websocket process refuse to start without it (the backend `Dockerfile`
defaults to `NODE_ENV=production`). Set it to a comma-separated list of every
exact frontend origin, the same list as the Privy allowed origins in step 4:

- the production project's custom domain and its `https://<prod-project>.pages.dev`;
- the develop project's custom domain and its `https://<develop-project>.pages.dev`.

Each entry is `scheme://host[:port]`, with no path and no trailing slash.
Wildcards (`*`, `https://*.pages.dev`) are not supported. An origin left off
the list gets no CORS headers at all, so every call from it fails in the
browser, public explorer reads included.

## Checking a build locally

```sh
pnpm build                                   # writes out/
npx wrangler@4.147.0 pages dev out --port 4020 --ip localhost
```

`wrangler pages dev` serves `out/` the way Pages does, including `_headers`
and `404.html`. `next dev` is unchanged for day-to-day work.

The `Dockerfile` still runs `next start`, which a static export does not
support; it is not part of this deployment.
