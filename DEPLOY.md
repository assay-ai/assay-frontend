# Deploying the app

The app is a static export: `next build` (`output: "export"` in
`next.config.js`) writes plain HTML, JS and CSS to `out/`. Nothing renders on a
server, so it is served from Cloudflare Pages. Record screens take their id in
the query string (`/receipts/view?id=…`, see `src/libs/routes.ts`) because a
static export cannot have run-time dynamic segments.

`.github/workflows/deploy.yml` builds and deploys on every push:

| Branch    | GitHub environment | Cloudflare Pages deployment                        |
| --------- | ------------------ | -------------------------------------------------- |
| `main`    | `production`       | production (`<project>.pages.dev`)                 |
| `develop` | `develop`          | branch alias (`develop.<project>.pages.dev`)       |

## One-time setup

### 1. Cloudflare Pages project

Create a Pages project with **`main` as its production branch**, as a
direct-upload project (the workflow uploads `out/`; Cloudflare does not build):

```sh
npx wrangler@4.147.0 pages project create <project> --production-branch main
```

Deploys from `develop` then land on the stable alias
`develop.<project>.pages.dev`. To give either one a custom domain, add it under
the project's **Custom domains**; for the develop alias, point a CNAME at
`develop.<project>.pages.dev`.

If develop should be a separate project instead, create a second project and
set `CLOUDFLARE_PAGES_PROJECT` to it in the `develop` environment. The
workflow deploys whatever project each environment names.

### 2. Cloudflare API token

Create an API token with **Account → Cloudflare Pages → Edit** for the account
that owns the project.

### 3. GitHub environments

In the repository settings, create two environments, `develop` and
`production`. In each one set:

| Kind     | Name                       | Value                                           |
| -------- | -------------------------- | ----------------------------------------------- |
| Variable | `NEXT_PUBLIC_BASE_URL`     | the app's public URL, e.g. `https://app.example.com` |
| Variable | `NEXT_PUBLIC_API_BASE_URL` | the backend API, e.g. `https://api.example.com/api/v1` |
| Variable | `NEXT_PUBLIC_PRIVY_APP_ID` | the Privy app id (25 characters)                |
| Variable | `NEXT_PUBLIC_MCP_URL`      | optional: the MCP endpoint shown on `/connect`  |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | the Pages project name                          |
| Secret   | `CLOUDFLARE_API_TOKEN`     | the token from step 2                           |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`    | the Cloudflare account id                       |

`NEXT_PUBLIC_*` values are inlined into the JavaScript every visitor
downloads, so they are Variables, not Secrets. Changing one takes effect on the
next deploy, not before: re-run the workflow (it has a manual
`workflow_dispatch` trigger) after editing them.

Optionally, protect `production` with required reviewers so a push to `main`
waits for approval before it deploys.

### 4. Privy allowed origins

In the Privy dashboard, add every origin the app is served from to the app's
allowed origins: the custom domain(s), `https://<project>.pages.dev` and
`https://develop.<project>.pages.dev`. An origin Privy does not allow leaves
the sign-in page waiting on "Checking your session".

### 5. Backend

The API must accept requests from the app's origin. `assay-backend` enables
CORS for every origin, so nothing needs changing there.

## Checking a build locally

```sh
pnpm build                                   # writes out/
npx wrangler@4.147.0 pages dev out --port 4020 --ip localhost
```

`wrangler pages dev` serves `out/` the way Pages does, including `_headers`
and `404.html`. `next dev` is unchanged for day-to-day work.

The `Dockerfile` still runs `next start`, which a static export does not
support; it is not part of this deployment.
